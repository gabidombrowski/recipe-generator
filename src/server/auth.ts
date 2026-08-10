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

  pages: { signIn: "/signin", error: "/signin" },

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
      if (allowed.length === 0) return false;

      const email = (profile?.email ?? user?.email ?? "").toLowerCase();
      return email !== "" && allowed.includes(email);
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
