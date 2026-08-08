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
  listConstraints,
  removeConstraint,
  setConstraintActive,
} from "~/server/db/config";
import { FRIDGE_SAFE_DAYS } from "./plan";
import { daysBetween, todayInTimezone } from "~/lib/days";
import { isoDateSchema, storageSchema } from "~/lib/schemas";
import { validateGuidelineNote, validateGuidelineTag } from "~/lib/guidelines";
import { constraintSchema } from "~/lib/constraints";

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
