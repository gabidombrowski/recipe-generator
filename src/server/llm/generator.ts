import { zodToJsonSchema } from "zod-to-json-schema";
import { type Anthropic as AnthropicNS } from "@anthropic-ai/sdk";
import { recipeRuleViolations } from "~/lib/constraints";
import {
  getClient,
  isAborted,
  isRetryable,
  MAX_TOKENS,
  MODELS,
  TIMEOUTS,
  withDeadline,
} from "./client";
import { loadPrompt, PROMPT_NAMES, renderPrompt } from "./prompts";
import { loggerFor } from "~/server/logger";
import {
  recordGeneration,
  withSpan,
  type TokenUsage,
} from "~/server/telemetry";
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

/** How to run the call, as opposed to what to ask for. */
export interface GenerationOptions {
  /** Cancels the call when the caller goes away. */
  signal?: AbortSignal;
  /** Per-attempt ceiling. Defaults to the interactive deadline. */
  timeoutMs?: number;
  /**
   * Called with each fragment of the recipe as the model emits it — the raw
   * partial JSON of the forced tool call. Wire it to a stream and the recipe
   * arrives as it is written; leave it unset and behaviour is unchanged.
   */
  onDelta?: (text: string) => void;
  /** Called at the start of each attempt (1-based); a retry is visible. */
  onAttempt?: (attempt: number) => void;
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
  // The contract is stated because the model cannot infer it: every checker
  // in this system (verifier, grocery filter, eval gate) matches exclusions
  // as substrings of ingredient names. Left unstated, "pepper" reads as bell
  // peppers and the model reasonably writes "black pepper" — which the
  // substring check then rejects. Predictable beats clever here: the model is
  // told the dumb rule and asked to be conservative around it.
  return [
    ...excluded.map((name) => `- ${name}`),
    "",
    "An exclusion bans every ingredient whose name CONTAINS that term:",
    '"pepper" also rules out black pepper, bell pepper and peppercorns.',
    "When in doubt, choose an ingredient whose name shares no words with any",
    "excluded term.",
  ].join("\n");
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

/**
 * Four, raised from three by eval evidence: twice across the armed runs a
 * generation exhausted its attempts against a dietary-rule violation and
 * failed closed — both times cook-thai, whose classic dishes genuinely fight
 * a fermented cap. The refusals were correct (never ship a rule-breaking
 * recipe), but a refusal on an ordinary request is still a failure, and one
 * more attempt is a few cents against a ~1% exhaustion rate on the worst
 * fixture. The weekly drift table is the judge of whether it was enough.
 */
const MAX_ATTEMPTS = 4;

/**
 * The two turns appended when a generation is rejected and retried.
 *
 * The shape is load-bearing, which is why it is a pure exported function with
 * its own test. The assistant turn ends in a `tool_use` block, and the API
 * requires the next user message to *answer* it with a `tool_result` before
 * saying anything else — a bare text follow-up is rejected with a 400. That
 * exact 400 shipped: every repair attempt died on it, invisibly, because the
 * first attempt usually succeeds. The eval suite's first real run caught it.
 *
 * The rejection rides inside the `tool_result` (marked `is_error`) so the
 * model sees it as the outcome of its call rather than as a new instruction,
 * with the re-prompt as a separate text block after it.
 */
export function repairTurns(
  message: AnthropicNS.Message,
  rejection: string,
  instruction: string,
): AnthropicNS.MessageParam[] {
  const toolUse = message.content.find(
    (block): block is AnthropicNS.ToolUseBlock => block.type === "tool_use",
  );

  const content: AnthropicNS.ContentBlockParam[] = toolUse
    ? [
        {
          type: "tool_result",
          tool_use_id: toolUse.id,
          is_error: true,
          content: rejection,
        },
        { type: "text", text: instruction },
      ]
    : // No tool_use to answer (forced tool_choice should make this
      // unreachable) — a plain text turn is then the correct shape.
      [{ type: "text", text: `${rejection}\n${instruction}` }];

  return [
    { role: "assistant", content: message.content },
    { role: "user", content },
  ];
}

function extractToolInput(
  message: AnthropicNS.Message,
):
  | { ok: true; input: unknown; toolUseId: string }
  | { ok: false; reason: string } {
  const toolUse = message.content.find(
    (block): block is AnthropicNS.ToolUseBlock =>
      block.type === "tool_use" && block.name === RECIPE_TOOL_NAME,
  );
  if (toolUse) return { ok: true, input: toolUse.input, toolUseId: toolUse.id };

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
      // Synthetic id: this branch means there was no real tool_use block, so
      // there is nothing for a later repair turn to answer. Callers only use
      // the id to build tool_result blocks against genuine tool calls.
      return { ok: true, input: JSON.parse(jsonMatch[0]), toolUseId: "" };
    } catch {
      return {
        ok: false,
        reason: "no tool_use block and prose JSON did not parse",
      };
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
  options: GenerationOptions = {},
): Promise<GenerationResult> {
  return withSpan("llm.generate_recipe", async () => {
    const client = getClient();
    const { system, promptHash } = buildSystemPrompt(request, context);
    const startedAt = Date.now();

    const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
    const messages: AnthropicNS.MessageParam[] = [
      {
        role: "user",
        content: `Write the recipe. ${describeRequest(request)}`,
      },
    ];

    let lastIssues: string[] = [];

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      let message: AnthropicNS.Message;
      try {
        options.onAttempt?.(attempt);
        // Streamed even when nobody listens: the request shape and the final
        // message are identical, one code path stays honest, and a stream
        // cannot sit silently against the HTTP timeout the way a large
        // non-streaming response can.
        const stream = client.messages.stream(
          {
            model: MODELS.generation,
            max_tokens: MAX_TOKENS,
            system,
            tools: [RECIPE_TOOL],
            // Forcing the tool is what removes prose from the output surface
            // entirely — the model has no path that returns anything else.
            tool_choice: { type: "tool", name: RECIPE_TOOL_NAME },
            messages,
          },
          // A fresh deadline per attempt: a retry after a slow first try
          // should get a full budget, not the remainder of one.
          {
            signal: withDeadline(
              options.timeoutMs ?? TIMEOUTS.interactive,
              options.signal,
            ),
          },
        );
        if (options.onDelta) {
          const onDelta = options.onDelta;
          stream.on("streamEvent", (event) => {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "input_json_delta"
            ) {
              onDelta(event.delta.partial_json);
            }
          });
        }
        message = await stream.finalMessage();
      } catch (error) {
        // A cancellation is not a transient failure: retrying it would ignore
        // the caller who just walked away, or restart the clock on a deadline
        // that has already expired.
        if (isAborted(error)) throw error;
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
        (usage.cacheReadInputTokens ?? 0) +
        (message.usage.cache_read_input_tokens ?? 0);

      const extracted = extractToolInput(message);
      if (!extracted.ok) {
        lastIssues = [extracted.reason];
        messages.push(
          ...repairTurns(
            message,
            extracted.reason,
            `Call ${RECIPE_TOOL_NAME} with the recipe.`,
          ),
        );
        continue;
      }

      const parsed = recipeBodySchema.safeParse(extracted.input);
      if (parsed.success) {
        // Schema is necessary, not sufficient: a well-formed recipe can still
        // use an excluded ingredient or blow a tag cap. The eval suite's
        // first real run proved the prompt alone lands ~91-94% on those, so
        // the loop now repairs them the same way it repairs schema failures.
        // Same checks, same substring contract as the runtime verifier.
        const ruleViolations = recipeRuleViolations(
          parsed.data,
          context.excluded.map((e) => e.toLowerCase()),
          context.config,
        );
        if (ruleViolations.length > 0 && attempt < MAX_ATTEMPTS) {
          lastIssues = ruleViolations;
          log.warn(
            { attempt, issues: ruleViolations },
            "generated recipe broke dietary rules",
          );
          messages.push(
            ...repairTurns(
              message,
              `The recipe breaks dietary rules:\n${ruleViolations
                .map((v) => `- ${v}`)
                .join("\n")}`,
              `Call ${RECIPE_TOOL_NAME} again with those fixed. Keep everything that was not flagged.`,
            ),
          );
          continue;
        }
        if (ruleViolations.length > 0) {
          // Out of attempts: fail loudly rather than return a recipe that
          // breaks the user's rules — downstream trusts what this returns.
          recordGeneration({
            model: MODELS.generation,
            operation: "recipe",
            usage,
            latencyMs: Date.now() - startedAt,
            retries: attempt - 1,
            status: "invalid",
          });
          throw new GenerationError(
            `Recipe still breaks dietary rules after ${MAX_ATTEMPTS} attempts`,
            attempt,
            ruleViolations,
          );
        }
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
      log.warn(
        { attempt, issues: lastIssues },
        "generated recipe failed schema validation",
      );

      messages.push(
        ...repairTurns(
          message,
          `That recipe did not match the schema:\n${lastIssues
            .map((i) => `- ${i}`)
            .join("\n")}`,
          `Call ${RECIPE_TOOL_NAME} again with those fixed.`,
        ),
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
