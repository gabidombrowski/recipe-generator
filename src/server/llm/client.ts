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
  client ??= new Anthropic({ maxRetries: 2 });
  return client;
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
