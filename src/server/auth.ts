import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import { isSecureOrigin, sessionCookieName } from "./auth-cookie";

/**
 * Authentication.
 *
 * This is a single-user app, and the auth model says so plainly: OAuth proves
 * *who* you are, and a one-entry allowlist decides whether that is the one
 * person allowed in. There is no user table, no roles and no invitations,
 * because there is no second user.
 *
 * Cloudflare Access sits in front of this in production (see `infra/`), so a
 * request reaching the app has already cleared one identity check. This is the
 * second layer, and it is the one that runs even if the tunnel is bypassed —
 * which is exactly why it is enforced here rather than assumed upstream.
 *
 * Deliberately free of database and Node-only imports: this module is pulled
 * into the edge middleware, and anything native would break that build.
 */

/** Sub-path the app is served under, or "" at the root. See `next.config.ts`. */
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/**
 * `ab***@example.com` — enough to tell two addresses apart in a log without
 * writing one down. This is a health app; the sign-in address is the one piece
 * of identifying data the server handles, and an operator debugging a failed
 * login does not need it in full.
 */
function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 2)}***@${domain}`;
}

function allowlistedEmails(): string[] {
  return (process.env.ALLOWED_EMAIL ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Note for anyone deploying this under a sub-path (`NEXT_PUBLIC_BASE_PATH`):
 * Auth.js builds every URL as `origin + basePath + action`, where `basePath`
 * must stay `/api/auth` because Next strips the sub-path before the route
 * handler runs. The library therefore never learns the prefix exists and
 * advertises a `redirect_uri` of `origin/api/auth/callback/github`.
 *
 * There is no configuration that fixes this. `redirectProxyUrl` looks like the
 * answer and is not: `init.js` sets `isOnRedirectProxy` when that URL's origin
 * equals the request's, which is always true here, and the override is then
 * skipped. Verified by reading the source and by measuring the emitted
 * `redirect_uri`, not assumed.
 *
 * The deployment resolves it instead — see `docs/deployment.md`. The OAuth
 * callback is registered at the un-prefixed path and the reverse proxy
 * forwards it in. Nothing here needs to change.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID,
      clientSecret: process.env.AUTH_GITHUB_SECRET,
    }),
  ],

  // JWT rather than a database session: nothing to look up, nothing to clean
  // up, and the middleware can validate without touching SQLite.
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 30 },

  /**
   * Prefixed by hand. Auth.js treats these as origin-relative and does not
   * know about a Next `basePath`, so under a sub-path an unauthenticated user
   * was being sent to the *host's* `/signin` — a page belonging to whatever
   * else is served there. Empty at the root, where it collapses to `/signin`.
   */
  pages: {
    signIn: `${BASE_PATH}/signin`,
    error: `${BASE_PATH}/signin`,
  },

  cookies: {
    sessionToken: {
      // Name and `secure` are derived from the served scheme rather than from
      // NODE_ENV — see `auth-cookie.ts` for why that distinction matters.
      name: sessionCookieName(),
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: isSecureOrigin(),
      },
    },
  },

  callbacks: {
    /**
     * The allowlist. An empty `ALLOWED_EMAIL` denies everyone rather than
     * admitting everyone — a misconfigured deploy should lock its owner out,
     * not open the door.
     */
    signIn({ profile, user }) {
      const allowed = allowlistedEmails();
      if (allowed.length === 0) {
        console.warn("[auth] denied: ALLOWED_EMAIL is unset or empty");
        return false;
      }

      const email = (profile?.email ?? user?.email ?? "").toLowerCase();
      if (email === "") {
        // The provider returned no address at all. For GitHub that means the
        // `user:email` scope was not granted, since it falls back to
        // /user/emails when the profile address is private.
        console.warn("[auth] denied: the provider returned no email address");
        return false;
      }

      if (!allowed.includes(email)) {
        // Masked on both sides. Enough to see *that* they differ and roughly
        // where, without putting either address in a log file. A bare
        // "AccessDenied" is otherwise indistinguishable from a broken config.
        console.warn(
          `[auth] denied: ${maskEmail(email)} is not in the allowlist ` +
            `(${allowed.map(maskEmail).join(", ")})`,
        );
        return false;
      }

      return true;
    },

    jwt({ token, profile }) {
      if (profile?.email) token.email = profile.email;
      return token;
    },

    session({ session, token }) {
      if (token.email) session.user.email = token.email;
      return session;
    },
  },

  trustHost: true,
});
