import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../init";
import {
  addFeedback,
  excludedLower,
  getFeedback,
  getRecipe,
  getSlot,
  listFeedback,
  listRecipes,
  markPromoted,
  writeSlots,
} from "~/server/db/queries";
import { getProfile, getSettings } from "~/server/db/state";
import { getDietaryConfig } from "~/server/db/config";
import { insertRecipe } from "~/server/db/recipes";
import { isLlmConfigured } from "~/server/llm/client";
import {
  getLibraryFillStatus,
  startLibraryFill,
  uncoveredCuisines,
} from "~/server/llm/library-fill";
import { generateRecipe, GenerationError } from "~/server/llm/generator";
import {
  similarFavorites,
  upsertRecipeEmbedding,
} from "~/server/embeddings/index";
import { RATE_LIMITS, rateLimit } from "~/server/rate-limit";
import { loggerFor } from "~/server/logger";
import { dayOfWeekFor } from "~/lib/days";
import { isTrainingDay } from "~/lib/macros";
import {
  feedbackVerdictSchema,
  isoDateSchema,
  mealTypeSchema,
} from "~/lib/schemas";

/**
 * AI generation and the feedback loop that feeds the eval suite.
 *
 * Rejections are not just logged — they can be promoted into `/evals/fixtures`,
 * so the golden set grows out of real failures rather than out of cases someone
 * imagined at the start. That is the whole point of feature 13: the eval suite
 * should get harder in exactly the places the model actually gets things wrong.
 */

const log = loggerFor("generation");

/**
 * Shared with the SSE route (`app/api/generate/stream`), which streams the
 * same generation for the generate tab. One schema, two transports.
 */
export const generateInputSchema = z.object({
  mealType: mealTypeSchema,
  cuisine: z.string().max(60).optional(),
  maxCookMinutes: z.number().int().positive().max(180).optional(),
  /** When set, the new recipe is assigned to this slot immediately. */
  targetDate: isoDateSchema.optional(),
  /** Which meal on that date; defaults to the main meal. */
  targetMeal: z.string().min(1).max(40).optional(),
  note: z.string().max(500).optional(),
});
const FIXTURES_DIR = join(process.cwd(), "evals", "fixtures");

export const generationRouter = router({
  available: protectedProcedure.query(() => ({
    configured: isLlmConfigured(),
  })),

  // ---------------------------------------------------------------------------
  // Filling the library from the cuisine palette
  // ---------------------------------------------------------------------------

  /** Which configured cuisines have no recipe, plus any run in progress. */
  libraryCoverage: protectedProcedure.query(() => ({
    uncovered: uncoveredCuisines(),
    status: getLibraryFillStatus(),
  })),

  /**
   * Starts a background fill and returns immediately.
   *
   * Returning the status rather than awaiting the work is the point: the run is
   * a couple of dozen sequential model calls, and holding an HTTP request open
   * for it would time out long before it finished.
   */
  fillLibrary: protectedProcedure.mutation(() => startLibraryFill()),

  generate: protectedProcedure
    .input(generateInputSchema)
    .mutation(async ({ ctx, input, signal }) => {
      if (!isLlmConfigured()) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "ANTHROPIC_API_KEY is not set, so AI generation is unavailable.",
        });
      }

      // Each generation costs real money; a runaway client must not be able to
      // run up a bill.
      const limit = rateLimit(
        `generate:${ctx.session.user?.id ?? "unknown"}`,
        RATE_LIMITS.generation,
      );
      if (!limit.ok) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `Generation limit reached. Try again in ${limit.retryAfterSeconds}s.`,
        });
      }

      const profile = getProfile();
      const trainingDay = input.targetDate
        ? isTrainingDay(profile, dayOfWeekFor(input.targetDate))
        : true;

      // Retrieve exemplars that resemble the request rather than arbitrary
      // favourites — the retrieval is what makes few-shot prompting useful here.
      const favorites = listRecipes().filter((r) => r.favorite);
      const exemplars = await similarFavorites(
        [input.cuisine, input.mealType, input.note].filter(Boolean).join(" "),
        favorites,
        3,
      );

      try {
        const result = await generateRecipe(
          input,
          {
            profile,
            trainingDay,
            excluded: excludedLower(),
            config: getDietaryConfig(),
            exemplars,
          },
          // tRPC surfaces the request's own signal, so closing the tab or
          // navigating away stops the generation instead of leaving it to run
          // to completion and bill for a recipe nobody will see.
          { signal },
        );

        const recipe = insertRecipe(result.recipe, {
          source: "ai",
          promptHash: result.promptHash,
          modelString: result.modelString,
        });

        // Index immediately so it is searchable and can act as an exemplar.
        await upsertRecipeEmbedding(recipe);

        // Auto-assign so the grocery list updates without a second action.
        //
        // The slot is created when it does not exist yet. Requiring one meant
        // generating into a week the scheduler had not touched assigned the
        // recipe nowhere, reported success, and left the grocery list empty —
        // the same silent no-op that `setMealSource` had.
        if (input.targetDate) {
          const meal = input.targetMeal ?? getSettings().mainMeal;
          const existing = getSlot(input.targetDate, meal);
          writeSlots(
            [
              {
                date: input.targetDate,
                meal,
                mealSource: existing?.mealSource ?? input.mealType,
                recipeId: recipe.id,
              },
            ],
            true,
          );
        }

        log.info(
          {
            recipe: recipe.name,
            costUsd: result.costUsd,
            attempts: result.attempts,
          },
          "recipe generated",
        );

        return {
          recipe,
          assignedTo: input.targetDate ?? null,
          assignedMeal: input.targetDate
            ? (input.targetMeal ?? getSettings().mainMeal)
            : null,
          costUsd: result.costUsd,
          attempts: result.attempts,
        };
      } catch (error) {
        if (error instanceof GenerationError) {
          throw new TRPCError({
            code: "UNPROCESSABLE_CONTENT",
            message: `${error.message}. Last issues: ${error.lastIssues?.join("; ") ?? "none"}`,
          });
        }
        throw error;
      }
    }),

  // -------------------------------------------------------------------------
  // Feedback
  // -------------------------------------------------------------------------

  feedback: protectedProcedure
    .input(
      z
        .object({ recipeId: z.number().int().positive().optional() })
        .default({}),
    )
    .query(({ input }) => listFeedback(input.recipeId)),

  submitFeedback: protectedProcedure
    .input(
      z.object({
        recipeId: z.number().int().positive(),
        verdict: feedbackVerdictSchema,
        reason: z.string().max(2000).default(""),
      }),
    )
    .mutation(({ input }) =>
      addFeedback(input.recipeId, input.verdict, input.reason),
    ),

  /**
   * Turns a rejection into an eval fixture.
   *
   * The fixture records the request that produced the bad recipe plus the
   * stated reason, so the next eval run reproduces the exact conditions. Named
   * by feedback id so re-promoting is idempotent.
   */
  promoteToFixture: protectedProcedure
    .input(z.object({ feedbackId: z.number().int().positive() }))
    .mutation(({ input }) => {
      const feedback = getFeedback(input.feedbackId);
      if (!feedback) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No such feedback entry.",
        });
      }

      const recipe = getRecipe(feedback.recipeId);
      if (!recipe) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "The recipe no longer exists.",
        });
      }

      const fixture = {
        id: `regression-${input.feedbackId}`,
        description: `Promoted from a rejection of "${recipe.name}": ${feedback.reason || "no reason given"}`,
        request: {
          mealType: recipe.mealType,
          cuisine: recipe.cuisine,
          maxCookMinutes: recipe.cookMinutes,
        },
        excluded: excludedLower(),
        origin: {
          promotedFromFeedbackId: input.feedbackId,
          rejectedRecipeName: recipe.name,
          rejectedPromptHash: recipe.promptHash,
          rejectedModelString: recipe.modelString,
        },
      };

      const filename = `regression-${input.feedbackId}.json`;
      writeFileSync(
        join(FIXTURES_DIR, filename),
        `${JSON.stringify(fixture, null, 2)}\n`,
        "utf8",
      );
      markPromoted(input.feedbackId);

      log.info({ filename }, "promoted rejection to eval fixture");
      return { filename };
    }),
});
