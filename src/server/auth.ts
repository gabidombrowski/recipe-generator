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
 * The allowlist, keyed on GitHub's numeric account id.
 *
 * An email is the obvious key and the wrong one. GitHub only discloses an
 * address if the account has a public one or the `user:email` scope is
 * actually granted, so a private-email account signs in successfully and then
 * gets turned away by an allowlist that never saw an address to compare —
 * which is exactly what happened here. Addresses also change, and an unverified
 * one is worth nothing as an identity claim.
 *
 * The numeric id is always present, never private, immutable for the life of
 * the account, and not reissued if the account is renamed. It is also not a
 * secret, so it can go in a log and in an example file without redaction. The
 * username would satisfy the first three and not the fourth: it can be changed
 * and then claimed by someone else.
 *
 * Find yours with: curl -s https://api.github.com/users/<username> | jq .id
 */
function allowlistedGitHubIds(): string[] {
  return (process.env.ALLOWED_GITHUB_ID ?? "")
    .split(",")
    .map((id) => id.trim())
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
     * The allowlist. An empty `ALLOWED_GITHUB_ID` denies everyone rather than
     * admitting everyone — a misconfigured deploy should lock its owner out,
     * not open the door. Each refusal says which of the three it was, because
     * a bare "AccessDenied" is indistinguishable from a broken config.
     */
    signIn({ profile, user }) {
      const allowed = allowlistedGitHubIds();
      if (allowed.length === 0) {
        console.warn("[auth] denied: ALLOWED_GITHUB_ID is unset or empty");
        return false;
      }

      // `profile` is GitHub's raw payload, where `id` is a number; `user` is
      // the provider's mapping of it, where the same value is a string.
      const id = String(profile?.id ?? user?.id ?? "");
      if (id === "") {
        console.warn("[auth] denied: the provider returned no account id");
        return false;
      }

      if (!allowed.includes(id)) {
        // Logged unmasked: a GitHub account id is public information, and an
        // operator cannot fix a mismatch they are not allowed to see.
        console.warn(
          `[auth] denied: GitHub id ${id} is not in the allowlist ` +
            `(${allowed.join(", ")})`,
        );
        return false;
      }

      return true;
    },

    /**
     * `token.sub` already carries the account id, set by Auth.js from the
     * provider's user mapping. The email is copied across only when there is
     * one — it is now decoration rather than identity, and an account with a
     * private address has none.
     */
    jwt({ token, profile }) {
      if (profile?.id) token.sub = String(profile.id);
      if (profile?.email) token.email = profile.email;
      return token;
    },

    session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      if (token.email) session.user.email = token.email;
      return session;
    },
  },

  trustHost: true,
});
