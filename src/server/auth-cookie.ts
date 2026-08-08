/**
 * Session cookie naming, derived from the scheme the app is actually served on.
 *
 * The obvious version of this keys off `NODE_ENV`, which is wrong in both
 * directions: a production build served over plain HTTP (a smoke test, a local
 * container, a health check) gets a `__Secure-`-prefixed cookie that browsers
 * refuse to store, and a non-production deployment over HTTPS gets a cookie
 * without the prefix it should have.
 *
 * `AUTH_URL` is the app's own statement of where it lives, so it is the right
 * input. Behind the Cloudflare Tunnel the browser leg is HTTPS and `AUTH_URL`
 * is `https://…`, so production gets the secure cookie it should.
 *
 * Pure and dependency-free so the Playwright setup can compute the same name
 * without booting Auth.js.
 */

/**
 * Named `isSecureOrigin` rather than `useSecureCookies` on purpose: a `use`
 * prefix marks a React hook, and both the linter and the next reader would take
 * a server-side helper for one.
 */
export function isSecureOrigin(authUrl = process.env.AUTH_URL): boolean {
  if (authUrl) return authUrl.startsWith("https://");
  // No AUTH_URL configured: fall back to the environment, and prefer the
  // stricter option in production.
  return process.env.NODE_ENV === "production";
}

export function sessionCookieName(authUrl = process.env.AUTH_URL): string {
  return isSecureOrigin(authUrl)
    ? "__Secure-authjs.session-token"
    : "authjs.session-token";
}
