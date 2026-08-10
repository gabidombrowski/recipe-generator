/**
 * Where to land after signing in.
 *
 * Split out of `auth.ts` for the same reason as `auth-cookie.ts`: importing
 * that module pulls in `next-auth`, which pulls in `next/server`, which does
 * not resolve under the unit-test runner. Pure and dependency-free, so the
 * rule can be tested without booting Auth.js.
 */

/**
 * Auth.js's own default resolves a relative target against the *origin* and
 * knows nothing about a Next `basePath`. Served under a sub-path, a successful
 * sign-in therefore landed on whatever else that domain serves rather than on
 * this app — which is a bug that shipped, not a hypothetical.
 *
 * Relative targets get the prefix; anything off-origin falls back to this
 * app's home rather than the host's, which also closes the open-redirect
 * shape. A no-op at the root, where `basePath` is empty.
 */
export function resolveRedirect(
  url: string,
  baseUrl: string,
  basePath: string,
): string {
  if (url.startsWith("/")) {
    // `url === basePath` and the trailing slash matter: a bare `startsWith`
    // would treat `/app-notes` as already inside `/app`.
    const alreadyPrefixed =
      basePath === "" || url === basePath || url.startsWith(`${basePath}/`);
    return `${baseUrl}${alreadyPrefixed ? url : `${basePath}${url}`}`;
  }

  try {
    if (new URL(url).origin === baseUrl) return url;
  } catch {
    // Not a URL at all; fall through to the safe default.
  }

  return `${baseUrl}${basePath}/`;
}
