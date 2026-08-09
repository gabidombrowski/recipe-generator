"use client";

import { useState } from "react";
import { Button, Input, Select } from "~/components/atoms";
import { Field, InfoHint } from "~/components/molecules";
import { DEFAULT_MEALS } from "~/lib/schemas";
import { addMeal, removeMeal, togglePlanned } from "~/lib/meal-config";

/**
 * Which meals make up a day, and which one the app plans.
 *
 * Naming the meals makes the division honest: a day's targets are split across
 * the meals listed here, and `plannedMeals` says which of them the scheduler
 * fills — each gets its own slot per day rather than the app assuming dinner.
 *
 */
export function MealFields({
  meals,
  plannedMeals,
  mainMeal,
  onChange,
}: {
  meals: string[];
  plannedMeals: string[];
  mainMeal: string;
  onChange: (next: {
    meals: string[];
    plannedMeals: string[];
    mainMeal: string;
  }) => void;
}) {
  const [draft, setDraft] = useState("");

  const config = { meals, plannedMeals, mainMeal };

  const add = () => {
    onChange(addMeal(config, draft));
    setDraft("");
  };

  return (
    <div className="space-y-4">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          add();
        }}
      >
        <Input
          aria-label="Add a meal"
          placeholder="Meal name"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          className="w-56"
        />
        <Button type="submit" variant="primary" disabled={!draft.trim()}>
          Add
        </Button>
        {meals.length === 0 && (
          <Button
            type="button"
            onClick={() =>
              onChange({
                meals: [...DEFAULT_MEALS],
                plannedMeals: ["Dinner"],
                mainMeal: "Dinner",
              })
            }
          >
            Use breakfast / lunch / dinner
          </Button>
        )}
      </form>

      {meals.length === 0 ? (
        <p className="rounded-lg border border-dashed border-warn/40 px-4 py-6 text-center text-sm text-warn">
          At least one meal is needed — the daily targets are divided across
          this list.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {meals.map((meal) => (
            <li key={meal}>
              <span className="inline-flex items-center gap-1 rounded-full bg-surface-sunken py-0.5 pr-1 pl-2.5 text-xs">
                {meal}
                <button
                  type="button"
                  aria-label={`Remove ${meal}`}
                  onClick={() => onChange(removeMeal(config, meal))}
                  className="rounded-full px-1 text-ink-muted hover:text-warn"
                >
                  ×
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {meals.length > 0 && (
        <div className="space-y-3 border-t border-border pt-3">
          <div>
            <p className="text-sm font-medium">The app plans</p>
            <p className="mt-0.5 mb-2 text-xs text-ink-muted">
              Each one gets its own slot every day, and its own line on the
              grocery list. Unticked meals still count towards your daily
              targets — the app just does not choose the food.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {meals.map((meal) => (
                <button
                  key={meal}
                  type="button"
                  aria-pressed={plannedMeals.includes(meal)}
                  onClick={() => onChange(togglePlanned(config, meal))}
                  className={
                    plannedMeals.includes(meal)
                      ? "rounded-lg border border-accent bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent"
                      : "rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-ink-muted hover:bg-surface-sunken"
                  }
                >
                  {meal}
                </button>
              ))}
            </div>
          </div>

          {plannedMeals.length > 0 && (
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Main meal" hint="Carries the cook / leftover cycle">
                <Select
                  value={mainMeal}
                  onChange={(event) =>
                    onChange({
                      meals,
                      plannedMeals,
                      mainMeal: event.target.value,
                    })
                  }
                >
                  {plannedMeals.map((meal) => (
                    <option key={meal} value={meal}>
                      {meal}
                    </option>
                  ))}
                </Select>
              </Field>
              <span className="flex items-center gap-2 pb-1.5 text-xs text-ink-muted">
                Only one meal can.
                <InfoHint>
                  A cook day means cooking once and eating the second portion
                  the next day. If two meals both followed that cycle you would
                  cook twice on a cook day and owe yourself two leftover
                  portions, so the cycle belongs to one meal. The others start
                  as quick meals, which accept a quick or an assembly recipe.
                </InfoHint>
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
