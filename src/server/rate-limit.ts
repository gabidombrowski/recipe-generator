/**
 * Rate limiting.
 *
 * An in-process fixed-window counter. That is the right tool here rather than a
 * compromise: this app runs as one Node process serving one person, so there is
 * no second instance for a shared store to coordinate with, and adding Redis
 * would buy nothing but a dependency and a failure mode.
 *
 * The honest limitation, stated so nobody has to discover it: counters reset on
 * restart, and a horizontally scaled deployment would need a shared store. If
 * this app ever grows a second instance, this module is the thing to replace.
 *
 * Edge-safe — no Node built-ins — so the middleware can use it too.
 */

interface Window {
  count: number;
  /** Epoch ms at which this window expires. */
  resetAt: number;
}

export interface RateLimitConfig {
  /** Requests permitted per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  /** Seconds until the window resets. Suitable for a `Retry-After` header. */
  retryAfterSeconds: number;
}

const buckets = new Map<string, Window>();

/**
 * Expired entries are swept opportunistically rather than on a timer, so the
 * map cannot grow without bound but also does not keep the event loop alive.
 */
function sweep(now: number): void {
  if (buckets.size < 512) return;
  for (const [key, window] of buckets) {
    if (window.resetAt <= now) buckets.delete(key);
  }
}

export function rateLimit(
  key: string,
  { limit, windowMs }: RateLimitConfig,
  now: number = Date.now(),
): RateLimitResult {
  sweep(now);

  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }

  existing.count += 1;
  const retryAfterSeconds = Math.ceil((existing.resetAt - now) / 1000);

  if (existing.count > limit) {
    return { ok: false, remaining: 0, retryAfterSeconds };
  }
  return { ok: true, remaining: limit - existing.count, retryAfterSeconds };
}

/** Test seam. */
export function resetRateLimits(): void {
  buckets.clear();
}

/**
 * Named policies, so call sites read as intent rather than as numbers.
 *
 * Generation is the expensive one: each call is an Anthropic request that costs
 * real money, so the cap is low enough that a runaway client loop cannot run up
 * a bill before anyone notices.
 */
export const RATE_LIMITS = {
  signIn: { limit: 10, windowMs: 10 * 60_000 },
  generation: { limit: 10, windowMs: 60 * 60_000 },
} as const satisfies Record<string, RateLimitConfig>;
