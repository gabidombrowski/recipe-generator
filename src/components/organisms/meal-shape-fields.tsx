"use client";

import { Input } from "~/components/atoms";
import { Field, InfoHint } from "~/components/molecules";
import { mealTypeSchema, type MealType } from "~/lib/schemas";

/**
 * What each kind of meal means.
 *
 * "Cook", "quick" and "assembly" are the vocabulary the whole planner runs on.
 */

export interface MealShapeDraft {
  mealType: MealType;
  servings: number | null;
  maxMinutes: number | null;
}

export const DEFAULT_MEAL_SHAPES: MealShapeDraft[] = [
  { mealType: "cook", servings: 2, maxMinutes: null },
  { mealType: "quick", servings: 1, maxMinutes: null },
  { mealType: "assembly", servings: 1, maxMinutes: null },
];

const BLURB: Record<MealType, string> = {
  cook: "A real cooking session. Yields tomorrow's leftover portion too.",
  quick: "Minimal effort, usually one pan.",
  assembly: "No cooking — put something together from what's in the house.",
};

export function MealShapeFields({
  value,
  onChange,
}: {
  value: MealShapeDraft[];
  onChange: (next: MealShapeDraft[]) => void;
}) {
  const set = (mealType: MealType, patch: Partial<MealShapeDraft>) =>
    onChange(
      value.map((s) => (s.mealType === mealType ? { ...s, ...patch } : s)),
    );

  /** Empty means "no limit", which is not the same as zero. */
  const toNullableNumber = (raw: string): number | null =>
    raw.trim() === "" ? null : Number(raw);

  return (
    <div className="space-y-4">
      {mealTypeSchema.options.map((mealType) => {
        const shape = value.find((s) => s.mealType === mealType);
        if (!shape) return null;

        return (
          <div
            key={mealType}
            className="flex flex-wrap items-start gap-3 rounded-lg border border-border p-3"
          >
            <div className="min-w-48 flex-1">
              <p className="plate plate--section text-xs">{mealType}</p>
              <p className="mt-1.5 text-xs text-ink-muted">{BLURB[mealType]}</p>
            </div>

            <Field label="Servings" hint="per meal">
              <Input
                type="number"
                min="1"
                max="12"
                aria-label={`Servings for a ${mealType} meal`}
                value={shape.servings ?? ""}
                onChange={(event) =>
                  set(mealType, {
                    servings: toNullableNumber(event.target.value),
                  })
                }
                className="w-24"
              />
            </Field>

            <Field label="Max minutes" hint="blank = no limit">
              <Input
                type="number"
                min="0"
                max="240"
                aria-label={`Maximum minutes for a ${mealType} meal`}
                value={shape.maxMinutes ?? ""}
                placeholder="any"
                onChange={(event) =>
                  set(mealType, {
                    maxMinutes: toNullableNumber(event.target.value),
                  })
                }
                className="w-28"
              />
            </Field>
          </div>
        );
      })}

      <p className="flex items-center gap-2 text-xs text-ink-muted">
        These become rules the app enforces, not hints.
        <InfoHint>
          The planner only proposes recipes that fit, a verifier rejects a week
          that breaks them, and the shopping list buys for the servings set
          here. Refine them later under Kitchen → Dietary rules.
        </InfoHint>
      </p>
    </div>
  );
}
