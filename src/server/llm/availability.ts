import { getSettings } from "~/server/db/state";
import { isLlmConfigured } from "./client";

/**
 * Whether the app may call the Claude API right now, and if not, why.
 *
 * Two independent conditions: a key must be set (`isLlmConfigured`), and the
 * user must not have switched AI off in Settings. Kept out of `client.ts` so
 * that module stays free of the database — the eval runner uses the client
 * without one.
 *
 * Every API-spending entry point checks this, not `isLlmConfigured` alone, so
 * the Settings switch really does stop all spend: manual generation, library
 * fill, the rule extractor, the agentic planner and scheduled AI recipes.
 */
export function aiStatus(): { available: boolean; reason: string | null } {
  if (!isLlmConfigured()) {
    return { available: false, reason: "ANTHROPIC_API_KEY is not set" };
  }
  if (!getSettings().aiEnabled) {
    return { available: false, reason: "AI generation is turned off in Settings" };
  }
  return { available: true, reason: null };
}

export const isAiAvailable = (): boolean => aiStatus().available;
