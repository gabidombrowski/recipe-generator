import { z } from "zod";
import { protectedProcedure, router } from "../init";
import { TRPCError } from "@trpc/server";
import {
  addExcluded,
  addGuideline,
  listGuidelines,
  removeGuideline,
  setGuidelineActive,
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
import { FRIDGE_SAFE_DAYS } from "./plan";
import { daysBetween, todayInTimezone } from "~/lib/days";
import { isoDateSchema, storageSchema } from "~/lib/schemas";
import {
  isMeaningful,
  validateGuidelineNote,
  validateGuidelineTag,
} from "~/lib/guidelines";

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
  // Dietary guidelines
  //
  // The free-text note reaches an LLM system prompt, so it is validated here
  // rather than trusted. Rejection reasons are returned so the UI can explain.
  // -------------------------------------------------------------------------
  guidelines: protectedProcedure.query(() => listGuidelines()),

  addGuideline: protectedProcedure
    .input(
      z.object({
        tag: z.string().max(32).nullable().default(null),
        maxPerRecipe: z.number().int().min(0).max(20).nullable().default(null),
        maxCookPerWeek: z.number().int().min(0).max(7).nullable().default(null),
        note: z.string().max(400).default(""),
      }),
    )
    .mutation(({ input }) => {
      const reasons: string[] = [];

      let tag: string | null = null;
      if (input.tag !== null && input.tag.trim() !== "") {
        const checked = validateGuidelineTag(input.tag);
        if (checked.ok) tag = checked.value;
        else reasons.push(...checked.reasons.map((r) => `Tag ${r}.`));
      }

      let note = "";
      if (input.note.trim() !== "") {
        const checked = validateGuidelineNote(input.note);
        if (checked.ok) note = checked.value;
        else reasons.push(...checked.reasons.map((r) => `Note ${r}.`));
      }

      const candidate = {
        tag,
        maxPerRecipe: input.maxPerRecipe,
        maxCookPerWeek: input.maxCookPerWeek,
        note,
      };

      if (!isMeaningful(candidate)) {
        reasons.push("A guideline needs either a tag with a limit, or a note.");
      }
      if (reasons.length > 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: reasons.join(" ") });
      }

      return addGuideline(candidate);
    }),

  setGuidelineActive: protectedProcedure
    .input(z.object({ id: z.number().int().positive(), active: z.boolean() }))
    .mutation(({ input }) => setGuidelineActive(input.id, input.active)),

  removeGuideline: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(({ input }) => removeGuideline(input.id)),

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
