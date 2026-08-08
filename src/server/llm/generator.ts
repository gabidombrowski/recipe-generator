import { zodToJsonSchema } from "zod-to-json-schema";
import { type Anthropic as AnthropicNS } from "@anthropic-ai/sdk";
import { getClient, isRetryable, MAX_TOKENS, MODELS } from "./client";
import { loadPrompt, PROMPT_NAMES, renderPrompt } from "./prompts";
import { loggerFor } from "~/server/logger";
import { recordGeneration, withSpan, type TokenUsage } from "~/server/telemetry";
import { computeMacroPlan } from "~/lib/macros";
import { describeConfig, type DietaryConfig } from "~/lib/constraints";
import {
  type MealType,
  type Profile,
  type RecipeBody,
  recipeBodySchema,
} from "~/lib/schemas";

/**
 * AI recipe generation via forced tool use.
 *
 * The Recipe zod schema is defined exactly once (`~/lib/schemas`) and converted
 * to a JSON Schema here for the tool definition. That is the whole point: the
 * shape the model is constrained to, the shape the database stores, the shape
 * the UI renders, and the shape the evals assert against cannot drift apart,
 * because they are the same object.
 *
 * Output is read from the tool-use block and validated with the same zod
 * schema. There is no prose parsing — a model that ignores a forced tool call
 * is a failure to surface, not a string to regex.
 */

const log = loggerFor("generator");

export const RECIPE_TOOL_NAME = "save_recipe";

/**
 * The JSON Schema handed to the model. `$refStrategy: "none"` inlines
 * definitions, because a schema full of `$ref` pointers is harder for a model
 * to follow than one that repeats itself.
 */
function buildRecipeToolSchema(): Record<string, unknown> {
  const schema = zodToJsonSchema(recipeBodySchema, {
    $refStrategy: "none",
    target: "jsonSchema7",
  }) as Record<string, unknown>;

  // The API rejects the meta-schema key.
  delete schema.$schema;
  return schema;
}

export const RECIPE_TOOL: AnthropicNS.Tool = {
  name: RECIPE_TOOL_NAME,
  description:
    "Save the finished recipe. Call this exactly once with the complete recipe; it is the only way to return your answer.",
  input_schema: buildRecipeToolSchema() as AnthropicNS.Tool["input_schema"],
};

// ---------------------------------------------------------------------------
// Request / context
// ---------------------------------------------------------------------------

export interface GenerationRequest {
  mealType: MealType;
  cuisine?: string;
  maxCookMinutes?: number;
  /** Free-text steer, e.g. "use up the spinach". */
  note?: string;
}

export interface GenerationContext {
  profile: Profile;
  /** Whether to size macros against a training or rest day. */
  trainingDay: boolean;
  excluded: readonly string[];
  /** The user's dietary rules, rendered into the prompt. Empty by default. */
  config: DietaryConfig;
  /** Favourite recipes to show as few-shot exemplars. */
  exemplars: readonly RecipeBody[];
}

export interface GenerationResult {
  recipe: RecipeBody;
  promptHash: string;
  modelString: string;
  usage: TokenUsage;
  costUsd: number;
  latencyMs: number;
  attempts: number;
}

export class GenerationError extends Error {
  constructor(
    message: string,
    readonly attempts: number,
    readonly lastIssues?: string[],
  ) {
    super(message);
    this.name = "GenerationError";
  }
}

// ---------------------------------------------------------------------------
// Prompt assembly
// ---------------------------------------------------------------------------

function describeMacroTargets(context: GenerationContext): string {
  const plan = computeMacroPlan(context.profile);
  const targets = context.trainingDay ? plan.training : plan.rest;
  const dayType = context.trainingDay ? "training" : "rest";

  return [
    `Today is a ${dayType} day: ${targets.kcal} kcal, ${targets.proteinG} g protein, ${targets.carbsG} g carbs, ${targets.fatG} g fat across the whole day.`,
    `They eat four meals, so this recipe should land near a quarter of that.`,
  ].join(" ");
}

function describeExclusions(excluded: readonly string[]): string {
  if (excluded.length === 0) {
    return "Nothing is excluded right now.";
  }
  return excluded.map((name) => `- ${name}`).join("\n");
}

/**
 * Favourites rendered as few-shot exemplars. Shows the model the house style —
 * quantity granularity, step terseness, how tags are used — far more precisely
 * than describing it in prose would.
 */
function describeExemplars(exemplars: readonly RecipeBody[]): string {
  if (exemplars.length === 0) return "";

  const rendered = exemplars
    .map((r) => JSON.stringify(r, null, 2))
    .join("\n\n");

  return [
    "## Recipes they already like",
    "",
    "These are their favourites, in the exact shape you should return. Match the",
    "level of detail and the way tags are used. Do not copy the dishes.",
    "",
    "```json",
    rendered,
    "```",
  ].join("\n");
}

function describeRequest(request: GenerationRequest): string {
  const parts = [`A **${request.mealType}** recipe.`];
  if (request.cuisine) parts.push(`Cuisine: ${request.cuisine}.`);
  if (request.maxCookMinutes) {
    parts.push(`It must take ${request.maxCookMinutes} minutes or fewer.`);
  }
  if (request.note) parts.push(`Additional note: ${request.note}`);
  return parts.join(" ");
}

export function buildSystemPrompt(
  request: GenerationRequest,
  context: GenerationContext,
): { system: string; promptHash: string } {
  const prompt = loadPrompt(PROMPT_NAMES.recipeGenerator);
  const system = renderPrompt(prompt, {
    MACRO_TARGETS: describeMacroTargets(context),
    EXCLUDE_LIST: describeExclusions(context.excluded),
    GUIDELINES: describeConfig(context.config),
    REQUEST: describeRequest(request),
    EXEMPLARS: describeExemplars(context.exemplars),
  });
  return { system, promptHash: prompt.hash };
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

const MAX_ATTEMPTS = 3;

function extractToolInput(
  message: AnthropicNS.Message,
): { ok: true; input: unknown } | { ok: false; reason: string } {
  const toolUse = message.content.find(
    (block): block is AnthropicNS.ToolUseBlock =>
      block.type === "tool_use" && block.name === RECIPE_TOOL_NAME,
  );
  if (toolUse) return { ok: true, input: toolUse.input };

  // Defensive fallback only. A forced tool_choice should make this unreachable;
  // if it fires, something changed upstream and we want it visible in the logs
  // rather than silently working via a parser nobody remembers writing.
  const text = message.content
    .filter((block): block is AnthropicNS.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    log.warn("no tool_use block; falling back to parsing JSON from prose");
    try {
      return { ok: true, input: JSON.parse(jsonMatch[0]) };
    } catch {
      return { ok: false, reason: "no tool_use block and prose JSON did not parse" };
    }
  }

  return {
    ok: false,
    reason: `no tool_use block (stop_reason: ${message.stop_reason ?? "unknown"})`,
  };
}

export async function generateRecipe(
  request: GenerationRequest,
  context: GenerationContext,
): Promise<GenerationResult> {
  return withSpan("llm.generate_recipe", async () => {
    const client = getClient();
    const { system, promptHash } = buildSystemPrompt(request, context);
    const startedAt = Date.now();

    const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
    const messages: AnthropicNS.MessageParam[] = [
      { role: "user", content: `Write the recipe. ${describeRequest(request)}` },
    ];

    let lastIssues: string[] = [];

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      let message: AnthropicNS.Message;
      try {
        message = await client.messages.create({
          model: MODELS.generation,
          max_tokens: MAX_TOKENS,
          system,
          tools: [RECIPE_TOOL],
          // Forcing the tool is what removes prose from the output surface
          // entirely — the model has no path that returns anything else.
          tool_choice: { type: "tool", name: RECIPE_TOOL_NAME },
          messages,
        });
      } catch (error) {
        if (isRetryable(error) && attempt < MAX_ATTEMPTS) {
          log.warn({ err: error, attempt }, "retryable API error");
          continue;
        }
        recordGeneration({
          model: MODELS.generation,
          operation: "recipe",
          usage,
          latencyMs: Date.now() - startedAt,
          retries: attempt - 1,
          status: "error",
        });
        throw error;
      }

      usage.inputTokens += message.usage.input_tokens;
      usage.outputTokens += message.usage.output_tokens;
      usage.cacheReadInputTokens =
        (usage.cacheReadInputTokens ?? 0) + (message.usage.cache_read_input_tokens ?? 0);

      const extracted = extractToolInput(message);
      if (!extracted.ok) {
        lastIssues = [extracted.reason];
        messages.push(
          { role: "assistant", content: message.content },
          { role: "user", content: `${extracted.reason}. Call ${RECIPE_TOOL_NAME} with the recipe.` },
        );
        continue;
      }

      const parsed = recipeBodySchema.safeParse(extracted.input);
      if (parsed.success) {
        const latencyMs = Date.now() - startedAt;
        const costUsd = recordGeneration({
          model: MODELS.generation,
          operation: "recipe",
          usage,
          latencyMs,
          retries: attempt - 1,
          status: "success",
        });
        return {
          recipe: parsed.data,
          promptHash,
          modelString: MODELS.generation,
          usage,
          costUsd,
          latencyMs,
          attempts: attempt,
        };
      }

      // Feed the validation errors back rather than starting over: the model
      // usually needs to fix one field, not rewrite the dish.
      lastIssues = parsed.error.issues.map(
        (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
      );
      log.warn({ attempt, issues: lastIssues }, "generated recipe failed schema validation");

      messages.push(
        { role: "assistant", content: message.content },
        {
          role: "user",
          content: `That recipe did not match the schema:\n${lastIssues
            .map((i) => `- ${i}`)
            .join("\n")}\nCall ${RECIPE_TOOL_NAME} again with those fixed.`,
        },
      );
    }

    recordGeneration({
      model: MODELS.generation,
      operation: "recipe",
      usage,
      latencyMs: Date.now() - startedAt,
      retries: MAX_ATTEMPTS - 1,
      status: "invalid",
    });

    throw new GenerationError(
      `Failed to generate a valid recipe after ${MAX_ATTEMPTS} attempts`,
      MAX_ATTEMPTS,
      lastIssues,
    );
  });
}
