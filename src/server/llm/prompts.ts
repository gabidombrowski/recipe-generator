import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Prompts as code.
 *
 * Every prompt lives in a versioned file under `/prompts`, is read from disk,
 * and is hashed. The hash is stored on every recipe the model produces and
 * printed in every eval report, so a regression can always be traced to the
 * exact prompt text that caused it — and a prompt change that skips the evals
 * is visible as a hash nobody has a passing run for.
 *
 * Versioning is by filename (`recipe-generator.v1.md`) rather than by git
 * history, so two prompt versions can coexist while one is being evaluated.
 */

export const PROMPT_NAMES = {
  recipeGenerator: "recipe-generator.v2.md",
  planner: "planner.v1.md",
  judge: "judge.v1.md",
  constraintExtractor: "constraint-extractor.v1.md",
} as const;

export type PromptName = (typeof PROMPT_NAMES)[keyof typeof PROMPT_NAMES];

export interface LoadedPrompt {
  name: string;
  text: string;
  /** SHA-256 of the file contents, first 16 hex chars. */
  hash: string;
}

const PROMPTS_DIR = join(process.cwd(), "prompts");

// Read once per process. Prompts are immutable at runtime; changing one is a
// deploy, which is exactly the property that makes the recorded hash meaningful.
const cache = new Map<string, LoadedPrompt>();

export function loadPrompt(name: PromptName): LoadedPrompt {
  const cached = cache.get(name);
  if (cached) return cached;

  const text = readFileSync(join(PROMPTS_DIR, name), "utf8");
  const hash = createHash("sha256").update(text).digest("hex").slice(0, 16);

  const loaded: LoadedPrompt = { name, text, hash };
  cache.set(name, loaded);
  return loaded;
}

/**
 * Substitutes `{{PLACEHOLDER}}` tokens.
 *
 * Throws on an unresolved placeholder rather than shipping a literal
 * `{{MACRO_TARGETS}}` to the model — a silently unsubstituted prompt is the
 * kind of bug that produces plausible-looking but subtly wrong output for weeks.
 */
export function renderPrompt(
  prompt: LoadedPrompt,
  values: Record<string, string>,
): string {
  const rendered = prompt.text.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = values[key];
    if (value === undefined) {
      throw new Error(`Prompt ${prompt.name} has no value for placeholder {{${key}}}`);
    }
    return value;
  });

  const leftover = rendered.match(/\{\{(\w+)\}\}/);
  if (leftover) {
    throw new Error(`Prompt ${prompt.name} still contains ${leftover[0]} after rendering`);
  }

  return rendered;
}

/** Test seam — clears the process-lifetime cache. */
export function clearPromptCache(): void {
  cache.clear();
}
