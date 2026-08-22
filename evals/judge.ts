import { z } from "zod";
import { toToolInputSchema } from "~/server/llm/tool-schema";
import { type Anthropic as AnthropicNS } from "@anthropic-ai/sdk";
import { getClient, MODELS, TIMEOUTS, withDeadline } from "~/server/llm/client";
import { loadPrompt, PROMPT_NAMES } from "~/server/llm/prompts";
import { type RecipeBody } from "~/lib/schemas";

/**
 * Tier 2: model-graded qualities.
 *
 * Report only. These scores never block a merge, and that is a deliberate
 * design decision rather than an oversight — a judge is itself a model, with
 * its own variance and its own failure modes, and gating a pipeline on one
 * makes the pipeline as flaky as the judge. Tier 1 catches what can be checked
 * exactly; Tier 2 is here to show a trend line across runs.
 *
 * Uses Haiku, because grading two rubric dimensions on a short document does
 * not need a frontier model and the suite is meant to cost cents.
 */

const gradeSchema = z.object({
  stepCoherence: z
    .number()
    .int()
    .min(1)
    .max(5)
    .describe("1-5; can a cook follow these steps?"),
  // Clamped rather than capped. A `.max(300)` here once zeroed an entire
  // run's Tier 2: the judge wrote rationales a few sentences long, every
  // grade failed validation on its *commentary*, and report-only trend data
  // vanished over prose length. The scores are the payload; the note is
  // decoration and can lose its tail.
  stepCoherenceNote: z.string().transform((s) => s.slice(0, 300)),
  seasoningBoldness: z
    .number()
    .int()
    .min(1)
    .max(5)
    .describe("1-5; does the dish have a point of view?"),
  seasoningBoldnessNote: z.string().transform((s) => s.slice(0, 300)),
});

export type Grade = z.infer<typeof gradeSchema>;

export const GRADE_TOOL: AnthropicNS.Tool = {
  name: "grade_recipe",
  description: "Return the two scores.",
  input_schema: toToolInputSchema(gradeSchema),
};

export interface JudgeResult {
  grade: Grade | null;
  model: string;
  promptHash: string;
  error?: string;
}

export async function judgeRecipe(recipe: RecipeBody): Promise<JudgeResult> {
  const prompt = loadPrompt(PROMPT_NAMES.judge);

  try {
    const message = await getClient().messages.create(
      {
        model: MODELS.judge,
        max_tokens: 1024,
        system: prompt.text,
        tools: [GRADE_TOOL],
        tool_choice: { type: "tool", name: "grade_recipe" },
        messages: [
          {
            role: "user",
            content: `Grade this recipe:\n\n${JSON.stringify(recipe, null, 2)}`,
          },
        ],
      },
      // Grading is report-only, so a hung judge must never hold a concurrency
      // slot that a generation could be using.
      { signal: withDeadline(TIMEOUTS.evals) },
    );

    const toolUse = message.content.find(
      (block): block is AnthropicNS.ToolUseBlock => block.type === "tool_use",
    );
    if (!toolUse) {
      return {
        grade: null,
        model: MODELS.judge,
        promptHash: prompt.hash,
        error: "no tool_use block",
      };
    }

    const parsed = gradeSchema.safeParse(toolUse.input);
    return parsed.success
      ? { grade: parsed.data, model: MODELS.judge, promptHash: prompt.hash }
      : {
          grade: null,
          model: MODELS.judge,
          promptHash: prompt.hash,
          error: parsed.error.issues.map((i) => i.message).join("; "),
        };
  } catch (error) {
    // A judge failure must never fail the suite — it is report-only.
    return {
      grade: null,
      model: MODELS.judge,
      promptHash: prompt.hash,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
