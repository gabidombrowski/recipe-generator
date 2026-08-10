import Anthropic from "@anthropic-ai/sdk";

/**
 * The Anthropic client.
 *
 * The API key is optional throughout the app: without it, AI generation and
 * agentic planner mode are simply unavailable, the scheduler runs
 * deterministically, and everything else works. That is deliberate — a
 * portfolio repo someone clones should be fully usable before they have a key.
 */

/**
 * Model choices, named by role rather than referenced as bare strings, so the
 * eval reports and the cost dashboard agree with what actually ran.
 */
export const MODELS = {
  /** Recipe generation and the agentic planner. */
  generation: "claude-sonnet-4-6",
  /** Tier 2 eval grading. Cheap, and its scores are report-only. */
  judge: "claude-haiku-4-5-20251001",
} as const;

/** Non-streaming ceiling that stays under the SDK's HTTP timeout. */
export const MAX_TOKENS = 8_000;

/**
 * Per-request deadlines, in milliseconds.
 *
 * The SDK's default is ten minutes, and `maxRetries: 2` multiplies it: one
 * stuck generation could hold a user-facing request for the better part of
 * half an hour with no way to cancel it. These are the ceilings at which a
 * call is considered hung rather than slow.
 *
 * `interactive` is short because somebody is watching a spinner — better a
 * clear failure they can retry than a page that never resolves. `background`
 * is generous because nobody is waiting on the library fill. `evals` sits
 * between the two: long enough for a genuinely slow generation, short enough
 * that one hung call cannot hold a concurrency slot for the whole run.
 */
export const TIMEOUTS = {
  interactive: 90_000,
  background: 300_000,
  evals: 120_000,
} as const;

let client: Anthropic | undefined;

export function isLlmConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

export function getClient(): Anthropic {
  if (!isLlmConfigured()) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. AI generation and agentic planning are disabled.",
    );
  }
  // `timeout` is a per-attempt ceiling, so the worst case is roughly
  // timeout x (1 + maxRetries). Set here as a backstop; individual calls pass
  // a tighter deadline for their context via `withDeadline`.
  client ??= new Anthropic({ maxRetries: 2, timeout: TIMEOUTS.background });
  return client;
}

/**
 * Combines a caller's cancellation signal with a deadline.
 *
 * Two distinct reasons to stop exist and both must work: the caller went away
 * (a closed tab, a second click superseding the first) and the call is simply
 * taking too long. `AbortSignal.any` means whichever fires first wins, and the
 * caller's signal is honoured even while the deadline has not expired.
 *
 * Returns a signal suitable for the SDK's `signal` option.
 */
export function withDeadline(
  timeoutMs: number,
  callerSignal?: AbortSignal,
): AbortSignal {
  const deadline = AbortSignal.timeout(timeoutMs);
  return callerSignal ? AbortSignal.any([callerSignal, deadline]) : deadline;
}

/**
 * Whether an error is a cancellation rather than a failure.
 *
 * Worth separating: an aborted call is usually the system working — the user
 * navigated away, or a deadline did its job — and logging it as an error
 * teaches whoever reads the logs to ignore them.
 */
export function isAborted(error: unknown): boolean {
  return (
    error instanceof Anthropic.APIUserAbortError ||
    (error instanceof Error &&
      (error.name === "AbortError" || error.name === "TimeoutError"))
  );
}

/** Whether an error is worth retrying rather than surfacing. */
export function isRetryable(error: unknown): boolean {
  return (
    error instanceof Anthropic.RateLimitError ||
    error instanceof Anthropic.InternalServerError ||
    error instanceof Anthropic.APIConnectionError
  );
}

export { Anthropic };
