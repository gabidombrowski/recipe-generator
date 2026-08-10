import { excludedLower, listRecipes } from "~/server/db/queries";
import { getProfile, getSettings } from "~/server/db/state";
import { getDietaryConfig } from "~/server/db/config";
import { insertRecipeIfAbsent } from "~/server/db/recipes";
import { upsertRecipeEmbedding } from "~/server/embeddings/index";
import { isLlmConfigured, TIMEOUTS } from "./client";
import { mapWithConcurrency } from "~/lib/concurrency";
import { generateRecipe } from "./generator";
import { loggerFor } from "~/server/logger";
import { type MealType } from "~/lib/schemas";

/**
 * Filling the library with one AI recipe per uncovered cuisine.
 *
 * Deliberately **not** part of seeding. Seeding runs inside `register()`, before
 * the first request is served, and putting twenty-odd sequential model calls
 * there would mean a first boot that hangs for minutes, costs real money without
 * being asked, and leaves the app unusable if the API is down. The committed
 * seed library covers every default cuisine already; this is the opt-in extra.
 *
 * So it is a user action that returns immediately and runs in the background.
 * "Background" here means an un-awaited async loop in the same process — which
 * is honest about what it is: progress lives in memory, and a restart forgets a
 * run in flight. For a single-user app that is the right amount of machinery;
 * anything durable would mean a job table and a worker for a button most people
 * press once.
 */

const log = loggerFor("library-fill");

export interface LibraryFillStatus {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  /** Cuisines this run set out to cover. */
  total: number;
  completed: number;
  /** Recipe names created, in order. */
  created: string[];
  failed: Array<{ cuisine: string; reason: string }>;
  costUsd: number;
  /** Set when a run could not start at all. */
  error: string | null;
}

const IDLE: LibraryFillStatus = {
  running: false,
  startedAt: null,
  finishedAt: null,
  total: 0,
  completed: 0,
  created: [],
  failed: [],
  costUsd: 0,
  error: null,
};

let status: LibraryFillStatus = { ...IDLE };

export function getLibraryFillStatus(): LibraryFillStatus {
  return {
    ...status,
    created: [...status.created],
    failed: [...status.failed],
  };
}

/** Cuisines in the configured palette with no recipe behind them. */
export function uncoveredCuisines(): string[] {
  const have = new Set(listRecipes().map((r) => r.cuisine.toLowerCase()));
  return getSettings().cuisines.filter((c) => !have.has(c.toLowerCase()));
}

/**
 * Rotated so a fill adds a spread rather than twenty cook recipes.
 *
 * Cook slots only accept cook recipes and quick slots accept quick or assembly,
 * so a library skewed to one type cannot fill a week however large it gets.
 */
const TYPE_ROTATION: MealType[] = ["cook", "quick", "assembly"];

/** Minutes to ask for, matching what each meal type means by default. */
const MINUTES_FOR: Record<MealType, number> = {
  cook: 30,
  quick: 10,
  assembly: 5,
};

/**
 * Starts a fill and returns immediately.
 *
 * Refuses to start a second run while one is going: two loops writing recipes
 * concurrently would race on the unique-name index and double the bill for the
 * same result.
 */
export function startLibraryFill(): LibraryFillStatus {
  if (status.running) return getLibraryFillStatus();

  if (!isLlmConfigured()) {
    status = {
      ...IDLE,
      error: "ANTHROPIC_API_KEY is not set, so nothing can be generated.",
    };
    return getLibraryFillStatus();
  }

  const targets = uncoveredCuisines();
  if (targets.length === 0) {
    status = {
      ...IDLE,
      error: "Every cuisine in your list already has a recipe.",
    };
    return getLibraryFillStatus();
  }

  status = {
    ...IDLE,
    running: true,
    startedAt: new Date().toISOString(),
    total: targets.length,
  };

  // Not awaited: the caller gets its response now and polls for progress. The
  // catch is what stops a rejection here becoming an unhandled rejection that
  // takes the process down.
  void runFill(targets).catch((error: unknown) => {
    log.error({ err: error }, "library fill crashed");
    status = {
      ...status,
      running: false,
      finishedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    };
  });

  return getLibraryFillStatus();
}

/** Background work yields to the interactive path; see the note in `runFill`. */
const FILL_CONCURRENCY = 2;

async function runFill(targets: readonly string[]): Promise<void> {
  const profile = getProfile();
  const config = getDietaryConfig();
  const excluded = excludedLower();

  /**
   * Two at a time, not five.
   *
   * Nobody is waiting on this, so latency is not the point — staying out of
   * the way of an interactive generation is. Each slot also drives a local
   * embedding computation, which is CPU-bound in this process rather than
   * network-bound, so a wider cap would start competing with the request the
   * user is actually watching.
   *
   * The `status` updates below are safe under concurrency because each is a
   * synchronous read-modify-write with no `await` inside it; JavaScript will
   * not interleave another runner partway through one.
   */
  await mapWithConcurrency(
    targets,
    FILL_CONCURRENCY,
    async (cuisine, index) => {
      const mealType = TYPE_ROTATION[index % TYPE_ROTATION.length]!;

      try {
        const result = await generateRecipe(
          { mealType, cuisine, maxCookMinutes: MINUTES_FOR[mealType] },
          {
            profile,
            // Generated for the library rather than for a particular day, so the
            // more demanding training-day targets are the safer assumption.
            trainingDay: true,
            excluded,
            config,
            exemplars: [],
          },
          // Generous: this is background work, and a slow call here costs
          // nobody anything. It exists so a hung one cannot hold its slot
          // forever.
          { timeoutMs: TIMEOUTS.background },
        );

        // `IfAbsent` because a name collision must not abort the run — the
        // library gains nothing from a duplicate, and losing the remaining
        // twenty cuisines to one clash would be a poor trade.
        const { recipe, created } = insertRecipeIfAbsent(result.recipe, {
          source: "ai",
          promptHash: result.promptHash,
          modelString: result.modelString,
        });

        if (created) await upsertRecipeEmbedding(recipe);

        status = {
          ...status,
          completed: status.completed + 1,
          created: created ? [...status.created, recipe.name] : status.created,
          costUsd: status.costUsd + result.costUsd,
        };
        log.info(
          { cuisine, recipe: recipe.name, created },
          "library fill: recipe added",
        );
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        status = {
          ...status,
          completed: status.completed + 1,
          failed: [...status.failed, { cuisine, reason }],
        };
        log.warn({ err: error, cuisine }, "library fill: cuisine failed");
      }
    },
  );

  status = { ...status, running: false, finishedAt: new Date().toISOString() };
  log.info(
    {
      created: status.created.length,
      failed: status.failed.length,
      costUsd: status.costUsd,
    },
    "library fill finished",
  );
}
