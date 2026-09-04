import { insertRecipe } from "~/server/db/recipes";
import {
  excludedLower,
  getWeekSlots,
  listLeftovers,
  listPantry,
  listRecipes,
  recentRecipeIds,
  recordSchedulerRun,
  weekIsPlanned,
  writeSlots,
} from "~/server/db/queries";
import { getProfile, getSettings } from "~/server/db/state";
import { getDietaryConfig } from "~/server/db/config";
import { isLlmConfigured } from "~/server/llm/client";
import { generateRecipe } from "~/server/llm/generator";
import { embed, similarFavorites } from "~/server/embeddings/index";
import { similarContext } from "~/server/embeddings/context";
import { planWeekWithAgent } from "~/server/llm/planner";
import { loggerFor } from "~/server/logger";
import { recordPlannerFallback, recordSchedulerRun as recordRunMetric, withSpan } from "~/server/telemetry";
import { dayOfWeekFor, todayInTimezone, weekStartFor, type IsoDate } from "~/lib/days";
import { isTrainingDay } from "~/lib/macros";
import { type PlannerVerdictRecord, type SchedulerRun } from "~/lib/schemas";
import { planWeekDeterministically } from "./deterministic";
import { type SlotPlan } from "./rules";

/**
 * The weekly generation run.
 *
 * Invariant: this function always leaves a week in place. Agentic planning is
 * attempted only when configured, its failure is caught and recorded, and the
 * deterministic planner runs instead. There is no path where the cron fires and
 * the user wakes up to an empty plan.
 */

const log = loggerFor("scheduler");

export interface RunOptions {
  /** Defaults to the week containing today, per `settings.generationDay`. */
  weekStart?: IsoDate;
  /** Re-plan slots that already have a recipe assigned. */
  force?: boolean;
  trigger: "cron" | "manual";
}

export type RunSummary = Omit<SchedulerRun, "id" | "startedAt">;

export async function runWeeklyGeneration(options: RunOptions): Promise<RunSummary> {
  return withSpan("scheduler.run", async () => {
    const profile = getProfile();
    const settings = getSettings();
    const today = todayInTimezone(settings.timezone);
    const weekStart = options.weekStart ?? weekStartFor(today, settings.generationDay);

    const finish = (summary: Omit<RunSummary, "weekStart" | "finishedAt">): RunSummary => {
      const full: RunSummary = {
        ...summary,
        weekStart,
        finishedAt: new Date().toISOString(),
      };
      recordSchedulerRun(full);
      recordRunMetric(full.status, full.fellBack);
      log.info({ ...full, trigger: options.trigger }, "scheduler run complete");
      return full;
    };

    // Idempotency: an already-planned week is left alone unless forced. This is
    // what makes a cron that fires twice (restart, clock adjustment) harmless.
    if (weekIsPlanned(weekStart) && !options.force) {
      return finish({
        mode: settings.plannerMode,
        fellBack: false,
        status: "skipped",
        slotsCreated: 0,
        aiRecipesCreated: 0,
        message: `Week of ${weekStart} already planned; nothing to do.`,
        verifierVerdicts: [],
      });
    }

    const recipes = listRecipes();
    const excluded = excludedLower();
    const recent = recentRecipeIds(weekStart, settings.repeatWindowWeeks);
    const config = getDietaryConfig();

    let slots: SlotPlan[];
    let verdicts: PlannerVerdictRecord[] = [];
    let fellBack = false;
    const notes: string[] = [];

    const useAgent = settings.plannerMode === "ai" && isLlmConfigured();
    if (settings.plannerMode === "ai" && !isLlmConfigured()) {
      fellBack = true;
      notes.push("Planner mode is 'ai' but ANTHROPIC_API_KEY is not set; planned deterministically.");
      recordPlannerFallback("no_api_key");
    }

    if (useAgent) {
      try {
        const result = await planWeekWithAgent({
          weekStart,
          profile,
          settings,
          data: {
            recipes,
            recentRecipeIds: recent,
            pantryOnHand: listPantry().filter((p) => p.onHand).map((p) => p.name),
            leftovers: listLeftovers(),
            excludedLower: excluded,
            config,
          },
        });
        slots = result.slots;
        verdicts = result.verdicts;
        notes.push(`Agentic planner accepted on proposal ${result.verdicts.length}.`);
      } catch (error) {
        fellBack = true;
        const reason = error instanceof Error ? error.message : String(error);
        notes.push(`Agentic planner failed (${reason}); planned deterministically.`);
        recordPlannerFallback(error instanceof Error ? error.name : "unknown");
        log.warn({ err: error, weekStart }, "planner failed; falling back");

        if (error && typeof error === "object" && "verdicts" in error) {
          verdicts = (error as { verdicts: PlannerVerdictRecord[] }).verdicts;
        }
        slots = null as unknown as SlotPlan[];
      }
    } else {
      slots = null as unknown as SlotPlan[];
    }

    // Deterministic planning covers both the configured-deterministic case and
    // every fallback path.
    if (!slots) {
      const plan = planWeekDeterministically({
        weekStart,
        profile,
        settings,
        recipes,
        excludedLower: excluded,
        recentRecipeIds: recent,
        config,
      });
      slots = plan.slots;
      notes.push(...plan.relaxations);
      if (plan.unfilled.length > 0) {
        notes.push(`Could not fill: ${plan.unfilled.join(", ")}.`);
      }
    }

    const slotsCreated = writeSlots(slots, options.force ?? false);

    const aiRecipesCreated = await fillWithNovelRecipes({
      weekStart,
      novelCount: settings.aiNovelRecipesPerWeek,
      excluded,
      notes,
      cuisines: settings.cuisines,
    });

    return finish({
      mode: settings.plannerMode,
      fellBack,
      status: "success",
      slotsCreated,
      aiRecipesCreated,
      message: notes.join(" ") || "Week planned.",
      verifierVerdicts: verdicts,
    });
  });
}

/**
 * Replaces up to `novelCount` cook slots with freshly generated recipes.
 *
 * Failures here are logged and swallowed: a week planned from the library is a
 * perfectly good week, and an API outage should not turn a successful run into
 * a failed one.
 */
async function fillWithNovelRecipes(args: {
  weekStart: IsoDate;
  novelCount: number;
  excluded: readonly string[];
  notes: string[];
  /** The user's cuisine palette. */
  cuisines: readonly string[];
}): Promise<number> {
  const { weekStart, novelCount, excluded, notes, cuisines } = args;
  if (novelCount <= 0) return 0;

  if (!isLlmConfigured()) {
    notes.push("aiNovelRecipesPerWeek is set but ANTHROPIC_API_KEY is not; skipped AI recipes.");
    return 0;
  }

  const profile = getProfile();
  const cookSlots = getWeekSlots(weekStart).filter((s) => s.mealSource === "cook");
  const targets = cookSlots.slice(0, novelCount);
  if (targets.length === 0) return 0;

  const usedCuisines = new Set(
    listRecipes()
      .filter((r) => r.mealType === "cook")
      .map((r) => r.cuisine.toLowerCase()),
  );
  // Prefer cuisines the library has not seen yet, so successive weeks widen
  // the rotation instead of circling the same few.
  const unused = cuisines.filter((c) => !usedCuisines.has(c.toLowerCase()));
  const freshCuisines = unused.length > 0 ? unused : cuisines;
  // Rotate deterministically by week so successive weeks explore new cuisines.
  const offset = Number(weekStart.replaceAll("-", "")) % Math.max(1, freshCuisines.length);

  const favorites = listRecipes().filter((r) => r.favorite);

  let created = 0;
  for (const [index, slot] of targets.entries()) {
    const cuisine = freshCuisines[(offset + index) % Math.max(1, freshCuisines.length)];

    // Retrieve per slot rather than reusing one arbitrary trio for the whole
    // week: every slot here asks for a different cuisine, so the exemplars
    // should differ too. The interactive path has always done this; the cron
    // is the one that runs unattended and produces most of the library.
    const query = `${cuisine} cook`;
    // Embed once per slot and share the vector; a week of slots would
    // otherwise run MiniLM twice over identical text for each one.
    const queryVector = await embed(query);
    const [exemplars, contextNotes] = await Promise.all([
      similarFavorites(query, favorites, 3, queryVector),
      similarContext(query, 3, queryVector),
    ]);

    try {
      const result = await generateRecipe(
        { mealType: "cook", cuisine, maxCookMinutes: 30 },
        {
          profile,
          trainingDay: isTrainingDay(profile, dayOfWeekFor(slot.date)),
          excluded,
          config: getDietaryConfig(),
          exemplars,
          contextNotes,
        },
      );

      const recipe = insertRecipe(result.recipe, {
        source: "ai",
        promptHash: result.promptHash,
        modelString: result.modelString,
      });

      // Auto-assign so the grocery list updates immediately.
      writeSlots(
        [{ date: slot.date, meal: slot.meal, mealSource: "cook", recipeId: recipe.id }],
        true,
      );
      created += 1;
      log.info({ date: slot.date, recipe: recipe.name, cuisine }, "AI recipe assigned");
    } catch (error) {
      log.warn({ err: error, date: slot.date, cuisine }, "AI recipe generation failed");
      notes.push(`AI recipe for ${slot.date} failed; kept the library selection.`);
    }
  }

  return created;
}
