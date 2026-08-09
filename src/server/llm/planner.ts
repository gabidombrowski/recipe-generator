import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { type Anthropic as AnthropicNS } from "@anthropic-ai/sdk";
import { getClient, isRetryable, MAX_TOKENS, MODELS } from "./client";
import { loadPrompt, PROMPT_NAMES, renderPrompt } from "./prompts";
import { loggerFor } from "~/server/logger";
import {
  recordGeneration,
  recordVerifierVerdict,
  withSpan,
  type TokenUsage,
} from "~/server/telemetry";
import { deriveSlotRoles, verifyWeek, type SlotPlan, type VerifyInput } from "~/server/scheduler/rules";
import { type DietaryConfig } from "~/lib/constraints";
import { formatShortDate, type IsoDate } from "~/lib/days";
import {
  type LeftoverItem,
  type PlannerVerdictRecord,
  type Profile,
  type Recipe,
  type Settings,
} from "~/lib/schemas";

/**
 * Agentic planner — the untrusted half of "untrusted planner, trusted verifier".
 *
 * The model is given tools to read the library, the recent history, and the
 * pantry, and then proposes a week. It is *not* trusted to have followed the
 * rules while doing so. Its proposal goes through `verifyWeek` — the same pure
 * functions the deterministic scheduler is built on — and is accepted only if
 * it passes.
 *
 * Rejection reasons are fed back once. On continued rejection, or any API
 * failure, the caller falls back to deterministic planning. The cron must
 * always produce a week; a clever plan is a nice-to-have, a plan is not.
 *
 * See `docs/planner-and-verifier.md` for the full argument.
 */

const log = loggerFor("planner");

/** Proposals the model gets before we give up and fall back. */
const MAX_PROPOSALS = 3;

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

const proposeWeekSchema = z.object({
  slots: z
    .array(
      z.object({
        date: z.string().describe("YYYY-MM-DD"),
        meal: z
          .string()
          .describe(
            "Which meal of the day this slot is, copied exactly from the slot you were given.",
          ),
        mealSource: z.enum(["cook", "quick", "assembly", "leftover"]),
        recipeId: z
          .number()
          .int()
          .nullable()
          .describe("Recipe id, or null for leftover days."),
      }),
    )
    // Not a fixed 7 any more: the count is seven days times however many meals
    // are planned. The verifier checks the exact number against the derived
    // slots, which is the check that actually matters — this bound only keeps a
    // runaway proposal from arriving.
    .min(1)
    .max(70)
    .describe(
      "One entry for every slot you were given, in date order, each carrying its date and meal.",
    ),
  reasoning: z
    .string()
    .max(1200)
    .describe("One short paragraph on why this week hangs together."),
});

function toolSchema(schema: z.ZodTypeAny): AnthropicNS.Tool["input_schema"] {
  const json = zodToJsonSchema(schema, {
    $refStrategy: "none",
    target: "jsonSchema7",
  }) as Record<string, unknown>;
  delete json.$schema;
  return json as AnthropicNS.Tool["input_schema"];
}

const EMPTY_INPUT: AnthropicNS.Tool["input_schema"] = {
  type: "object",
  properties: {},
};

const PLANNER_TOOLS: AnthropicNS.Tool[] = [
  {
    name: "list_recipes",
    description:
      "List every recipe available, with id, name, cuisine, meal type, cook minutes, macros, favourite flag, and per-tag ingredient counts.",
    input_schema: EMPTY_INPUT,
  },
  {
    name: "get_recent_history",
    description:
      "List recipes scheduled inside the repeat window, which must not be reused this week.",
    input_schema: EMPTY_INPUT,
  },
  {
    name: "read_pantry_and_leftovers",
    description:
      "Read pantry staples currently on hand and the leftover portions already in the fridge or freezer.",
    input_schema: EMPTY_INPUT,
  },
  {
    name: "propose_week",
    description:
      "Submit the finished week. A deterministic verifier checks it against the rules and may reject it with reasons.",
    input_schema: toolSchema(proposeWeekSchema),
  },
];

// ---------------------------------------------------------------------------
// Data the planner may read
// ---------------------------------------------------------------------------

export interface PlannerData {
  recipes: readonly Recipe[];
  recentRecipeIds: ReadonlySet<number>;
  pantryOnHand: readonly string[];
  leftovers: readonly LeftoverItem[];
  excludedLower: readonly string[];
  config: DietaryConfig;
}

function recipeSummary(recipe: Recipe) {
  return {
    id: recipe.id,
    name: recipe.name,
    cuisine: recipe.cuisine,
    mealType: recipe.mealType,
    cookMinutes: recipe.cookMinutes,
    servings: recipe.servings,
    macrosPerServing: recipe.macrosPerServing,
    favorite: recipe.favorite,
    tagCounts: recipe.tagCounts,
  };
}

function runTool(name: string, data: PlannerData): unknown {
  switch (name) {
    case "list_recipes":
      return { recipes: data.recipes.map(recipeSummary) };
    case "get_recent_history":
      return {
        recentlyUsedRecipeIds: [...data.recentRecipeIds],
        note: "These may not be reused this week.",
      };
    case "read_pantry_and_leftovers":
      return {
        pantryOnHand: data.pantryOnHand,
        leftovers: data.leftovers.map((l) => ({
          recipeName: l.recipeName,
          cookedDate: l.cookedDate,
          storage: l.storage,
          portions: l.portions,
        })),
      };
    default:
      return { error: `unknown tool ${name}` };
  }
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

function describeSlotRoles(
  weekStart: IsoDate,
  profile: Profile,
  settings: Settings,
): string {
  return deriveSlotRoles(weekStart, profile, {
    meals: settings.plannedMeals,
    mainMeal: settings.mainMeal,
  })
    .map(
      ({ date, meal, mealSource }) =>
        `- ${date} (${formatShortDate(date)}) ${meal}: ${mealSource}`,
    )
    .join("\n");
}

function describeRules(settings: Settings, data: PlannerData): string {
  const rules = [
    `- Do not reuse any recipe scheduled in the last ${settings.repeatWindowWeeks} week(s); call get_recent_history for the list.`,
    "- Do not use the same recipe twice in one week.",
    "- Cook slots take cook recipes; assembly slots take assembly recipes; quick slots take quick or assembly recipes.",
    "- Leftover slots take no recipe at all.",
    ...(data.config.mealMacros
      ? [
          `- Every meal must provide at least ${data.config.mealMacros.proteinMinG} g protein per serving and sit in a plausible calorie range for the day.`,
        ]
      : []),
  ];

  for (const cap of data.config.tagCaps) {
    if (cap.maxPerWeek === null) continue;
    rules.push(
      `- At most ${cap.maxPerWeek} cook recipe(s) containing "${cap.tag}" ingredients, across the whole week.`,
    );
  }
  if (data.excludedLower.length > 0) {
    rules.push(
      `- These ingredients are excluded and must not appear in any chosen recipe: ${data.excludedLower.join(", ")}.`,
    );
  }

  return rules.join("\n");
}

// ---------------------------------------------------------------------------
// The loop
// ---------------------------------------------------------------------------

export interface PlannerResult {
  slots: SlotPlan[];
  verdicts: PlannerVerdictRecord[];
  usage: TokenUsage;
  costUsd: number;
  promptHash: string;
}

export class PlannerRejected extends Error {
  constructor(
    message: string,
    readonly verdicts: PlannerVerdictRecord[],
  ) {
    super(message);
    this.name = "PlannerRejected";
  }
}

export async function planWeekWithAgent(args: {
  weekStart: IsoDate;
  profile: Profile;
  settings: Settings;
  data: PlannerData;
}): Promise<PlannerResult> {
  const { weekStart, profile, settings, data } = args;

  return withSpan("llm.plan_week", async () => {
    const client = getClient();
    const prompt = loadPrompt(PROMPT_NAMES.planner);
    const system = renderPrompt(prompt, {
      SLOT_ROLES: describeSlotRoles(weekStart, profile, settings),
      RULES: describeRules(settings, data),
    });

    const recipesByIdMap = new Map(data.recipes.map((r) => [r.id, r]));
    const verifyBase: Omit<VerifyInput, "slots"> = {
      weekStart,
      profile,
      settings,
      recipesById: recipesByIdMap,
      excludedLower: data.excludedLower,
      recentRecipeIds: data.recentRecipeIds,
      config: data.config,
    };

    const messages: AnthropicNS.MessageParam[] = [
      {
        role: "user",
        content: `Plan the week beginning ${weekStart}. Read the tools you need, then call propose_week.`,
      },
    ];

    const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
    const verdicts: PlannerVerdictRecord[] = [];
    const startedAt = Date.now();
    let proposals = 0;

    // Bounded by proposals, not by turns: a planner that keeps reading tools
    // without proposing is stopped by max_tokens, and one that keeps proposing
    // rejected weeks is stopped here.
    for (let turn = 0; turn < 12; turn += 1) {
      let message: AnthropicNS.Message;
      try {
        message = await client.messages.create({
          model: MODELS.generation,
          max_tokens: MAX_TOKENS,
          system,
          tools: PLANNER_TOOLS,
          messages,
        });
      } catch (error) {
        if (isRetryable(error) && turn < 11) {
          log.warn({ err: error, turn }, "retryable planner API error");
          continue;
        }
        recordGeneration({
          model: MODELS.generation,
          operation: "planner",
          usage,
          latencyMs: Date.now() - startedAt,
          retries: turn,
          status: "error",
        });
        throw error;
      }

      usage.inputTokens += message.usage.input_tokens;
      usage.outputTokens += message.usage.output_tokens;

      const toolUses = message.content.filter(
        (block): block is AnthropicNS.ToolUseBlock => block.type === "tool_use",
      );

      if (toolUses.length === 0) {
        // No tool call and no proposal — nothing more will come of this.
        break;
      }

      messages.push({ role: "assistant", content: message.content });
      const results: AnthropicNS.ToolResultBlockParam[] = [];

      for (const toolUse of toolUses) {
        if (toolUse.name !== "propose_week") {
          results.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: JSON.stringify(runTool(toolUse.name, data)),
          });
          continue;
        }

        proposals += 1;
        const parsed = proposeWeekSchema.safeParse(toolUse.input);

        if (!parsed.success) {
          const reasons = parsed.error.issues.map(
            (i) => `${i.path.join(".") || "(root)"}: ${i.message}`,
          );
          verdicts.push({ attempt: proposals, ok: false, reasons });
          recordVerifierVerdict(false, proposals);
          results.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            is_error: true,
            content: `The proposal did not match the schema:\n${reasons.join("\n")}`,
          });
          continue;
        }

        const slots: SlotPlan[] = parsed.data.slots.map((s) => ({
          date: s.date,
          meal: s.meal,
          mealSource: s.mealSource,
          recipeId: s.recipeId,
        }));

        const verdict = verifyWeek({ ...verifyBase, slots });
        verdicts.push({ attempt: proposals, ok: verdict.ok, reasons: verdict.reasons });
        recordVerifierVerdict(verdict.ok, proposals);

        if (verdict.ok) {
          const costUsd = recordGeneration({
            model: MODELS.generation,
            operation: "planner",
            usage,
            latencyMs: Date.now() - startedAt,
            retries: proposals - 1,
            status: "success",
          });
          log.info({ weekStart, proposals }, "planner proposal accepted by verifier");
          return { slots, verdicts, usage, costUsd, promptHash: prompt.hash };
        }

        log.warn({ weekStart, proposals, reasons: verdict.reasons }, "verifier rejected proposal");
        results.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          is_error: true,
          content: `The verifier rejected this week:\n${verdict.reasons
            .map((r) => `- ${r}`)
            .join("\n")}\nFix exactly these and call propose_week again.`,
        });
      }

      messages.push({ role: "user", content: results });

      if (proposals >= MAX_PROPOSALS) break;
    }

    recordGeneration({
      model: MODELS.generation,
      operation: "planner",
      usage,
      latencyMs: Date.now() - startedAt,
      retries: proposals,
      status: "invalid",
    });

    throw new PlannerRejected(
      `Planner did not produce a verifiable week in ${proposals} proposal(s)`,
      verdicts,
    );
  });
}
