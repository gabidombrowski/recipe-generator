import { z } from "zod";
import { protectedProcedure, router } from "../init";
import { TRPCError } from "@trpc/server";
import {
  addExcluded,
  addPantryStaple,
  discardLeftover,
  eatPortion,
  listExcluded,
  listLeftovers,
  listPantry,
  removeExcluded,
  removePantryStaple,
  setPantryOnHand,
  storePortion,
} from "~/server/db/queries";
import { getSettings } from "~/server/db/state";
import {
  addConstraint,
  addConstraints,
  addIngredientTag,
  listConstraints,
  listIngredientTags,
  removeConstraint,
  removeIngredientTag,
  setConstraintActive,
} from "~/server/db/config";
import { extractConstraints } from "~/server/llm/extractor";
import { isLlmConfigured } from "~/server/llm/client";
import { RATE_LIMITS, rateLimit } from "~/server/rate-limit";
import { FRIDGE_SAFE_DAYS } from "./plan";
import { daysBetween, todayInTimezone } from "~/lib/days";
import { isoDateSchema, storageSchema } from "~/lib/schemas";
import { validateGuidelineNote, validateGuidelineTag } from "~/lib/guidelines";
import { constraintSchema, SUGGESTED_TAGS } from "~/lib/constraints";

/**
 * Exclusions, pantry staples, and the leftover tracker.
 *
 * The leftover rule this app exists to enforce: a refrigerated portion is
 * tomorrow's food, not this week's food. Anything older than a day gets a
 * warning; freezer items never do.
 */
export const kitchenRouter = router({
  // -------------------------------------------------------------------------
  // Exclusions
  // -------------------------------------------------------------------------
  excluded: protectedProcedure.query(() => listExcluded()),

  addExcluded: protectedProcedure
    .input(z.object({ name: z.string().min(1).max(120) }))
    .mutation(({ input }) => addExcluded(input.name)),

  removeExcluded: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(({ input }) => removeExcluded(input.id)),

  // -------------------------------------------------------------------------
  // Dietary constraints
  //
  // Everything the app enforces is a row here. Free-text notes reach an LLM
  // system prompt, so those are validated rather than trusted; the structured
  // kinds are validated by their zod schema.
  // -------------------------------------------------------------------------
  constraints: protectedProcedure.query(() => listConstraints()),

  addConstraint: protectedProcedure
    .input(constraintSchema)
    .mutation(({ input }) => {
      if (input.kind === "note") {
        const checked = validateGuidelineNote(input.text);
        if (!checked.ok) {
          throw new TRPCError({ code: "BAD_REQUEST", message: checked.reasons.join(" ") });
        }
        return addConstraint({ kind: "note", text: checked.value });
      }

      if (input.kind === "tag_cap") {
        const checked = validateGuidelineTag(input.tag);
        if (!checked.ok) {
          throw new TRPCError({ code: "BAD_REQUEST", message: checked.reasons.join(" ") });
        }
        if (input.maxPerRecipe === null && input.maxPerWeek === null) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "A tag limit needs a per-recipe or per-week cap.",
          });
        }
        return addConstraint({ ...input, tag: checked.value });
      }

      return addConstraint(input);
    }),

  setConstraintActive: protectedProcedure
    .input(z.object({ id: z.number().int().positive(), active: z.boolean() }))
    .mutation(({ input }) => setConstraintActive(input.id, input.active)),

  removeConstraint: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(({ input }) => removeConstraint(input.id)),

  // -------------------------------------------------------------------------
  // Tag vocabulary
  // -------------------------------------------------------------------------
  ingredientTags: protectedProcedure.query(() => ({
    tags: listIngredientTags(),
    suggested: SUGGESTED_TAGS,
  })),

  addIngredientTag: protectedProcedure
    .input(
      z.object({
        name: z.string().min(2).max(32),
        matchPatterns: z.array(z.string().min(2).max(60)).min(1),
      }),
    )
    .mutation(({ input }) => addIngredientTag(input.name, input.matchPatterns)),

  removeIngredientTag: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(({ input }) => removeIngredientTag(input.id)),

  // -------------------------------------------------------------------------
  // Setup interview
  //
  // Describe your needs in prose; Claude proposes structured rules you approve
  // one at a time. The model is a parser here, never an author — nothing it
  // returns is applied until `acceptProposals` is called with what you picked.
  // -------------------------------------------------------------------------
  proposeConstraints: protectedProcedure
    .input(z.object({ description: z.string().min(10).max(2000) }))
    .mutation(async ({ ctx, input }) => {
      if (!isLlmConfigured()) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "ANTHROPIC_API_KEY is not set, so the setup interview is unavailable.",
        });
      }

      // Costs money like any other generation, so it shares the cap.
      const limit = rateLimit(
        `extract:${ctx.session.user?.email ?? "unknown"}`,
        RATE_LIMITS.generation,
      );
      if (!limit.ok) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `Rate limit reached. Try again in ${limit.retryAfterSeconds}s.`,
        });
      }

      return extractConstraints(input.description, listIngredientTags());
    }),

  acceptProposals: protectedProcedure
    .input(z.object({ constraints: z.array(constraintSchema).min(1).max(20) }))
    .mutation(({ input }) => addConstraints(input.constraints)),

  // -------------------------------------------------------------------------
  // Pantry
  // -------------------------------------------------------------------------
  pantry: protectedProcedure.query(() => listPantry()),

  setPantryOnHand: protectedProcedure
    .input(z.object({ id: z.number().int().positive(), onHand: z.boolean() }))
    .mutation(({ input }) => setPantryOnHand(input.id, input.onHand)),

  addPantryStaple: protectedProcedure
    .input(z.object({ name: z.string().min(1).max(120) }))
    .mutation(({ input }) => addPantryStaple(input.name)),

  removePantryStaple: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(({ input }) => removePantryStaple(input.id)),

  // -------------------------------------------------------------------------
  // Leftovers
  // -------------------------------------------------------------------------
  leftovers: protectedProcedure.query(() => {
    const today = todayInTimezone(getSettings().timezone);
    return listLeftovers().map((item) => {
      const ageDays = daysBetween(item.cookedDate, today);
      return {
        ...item,
        ageDays,
        atRisk: item.storage === "fridge" && ageDays > FRIDGE_SAFE_DAYS,
        dueToday: item.storage === "fridge" && ageDays === FRIDGE_SAFE_DAYS,
      };
    });
  }),

  /** "Stored 1 portion" — defaults to the fridge, and to today. */
  storePortion: protectedProcedure
    .input(
      z.object({
        recipeName: z.string().min(1).max(120),
        storage: storageSchema.default("fridge"),
        cookedDate: isoDateSchema.optional(),
      }),
    )
    .mutation(({ input }) =>
      storePortion(
        input.recipeName,
        input.cookedDate ?? todayInTimezone(getSettings().timezone),
        input.storage,
      ),
    ),

  /** "Ate stored portion". */
  eatPortion: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(({ input }) => eatPortion(input.id)),

  discardLeftover: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(({ input }) => discardLeftover(input.id)),
});
