import { NextResponse } from "next/server";
import { auth } from "~/server/auth";
import { RATE_LIMITS, rateLimit } from "~/server/rate-limit";

/**
 * Route gating.
 *
 * Deny by default: everything requires a session except the handful of paths
 * listed here. Adding a new page therefore cannot accidentally ship
 * unauthenticated — forgetting to update this file fails closed.
 *
 * tRPC procedures are gated a second time in `protectedProcedure`. That is not
 * redundant: middleware protects the HTTP route, and the procedure guard
 * protects the call, which matters for anything invoked server-side or from a
 * future non-HTTP caller.
 */

/** Reachable without a session. Everything else is not. */
const PUBLIC_PATHS = new Set([
  "/healthz",
  // Present for the container/compose topology; in production the OTel
  // Prometheus exporter binds its own port to the private network instead.
  "/metrics",
  "/signin",
]);

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  // Auth.js needs its own callback and CSRF endpoints to be reachable.
  if (pathname.startsWith("/api/auth/")) return true;
  return false;
}

/** Best-effort client identity for rate limiting behind the tunnel. */
function clientKey(request: Request): string {
  const headers = request.headers;
  return (
    headers.get("cf-connecting-ip") ??
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headers.get("x-real-ip") ??
    "unknown"
  );
}

export default auth((request) => {
  const { pathname } = request.nextUrl;

  // Throttle sign-in before it reaches the OAuth handler, so a credential
  // stuffing loop burns against this counter rather than against GitHub.
  if (pathname.startsWith("/api/auth/signin") || pathname.startsWith("/api/auth/callback")) {
    const result = rateLimit(`signin:${clientKey(request)}`, RATE_LIMITS.signIn);
    if (!result.ok) {
      return new NextResponse("Too many sign-in attempts.", {
        status: 429,
        headers: { "Retry-After": String(result.retryAfterSeconds) },
      });
    }
  }

  if (isPublic(pathname)) return NextResponse.next();

  if (!request.auth) {
    // API and tRPC callers get a status they can act on; humans get a redirect.
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const signInUrl = new URL("/signin", request.nextUrl.origin);
    signInUrl.searchParams.set("callbackUrl", request.nextUrl.pathname);
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
});

export const config = {
  /**
   * Everything except Next's own static output and the favicon. Written as an
   * exclusion so new routes are covered the moment they exist.
   */
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
