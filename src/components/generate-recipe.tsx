"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTRPC } from "~/trpc/react";
import { Button, Input, Select, cx } from "./ui";
import { type MealType } from "~/lib/schemas";

/**
 * Generate a novel recipe into a specific plan slot.
 *
 * Auto-assignment is the reason this lives next to the slot rather than in the
 * library: the generated recipe lands in the plan, and the grocery list picks
 * it up on the next read with no further action.
 */
export function GenerateRecipeButton({
  targetDate,
  targetMeal,
  mealType,
  onGenerated,
}: {
  targetDate?: string;
  /** Which meal on that date. Defaults server-side to the main meal. */
  targetMeal?: string;
  mealType: MealType;
  onGenerated: () => void;
}) {
  const trpc = useTRPC();
  const [open, setOpen] = useState(false);
  const [cuisine, setCuisine] = useState("");
  const [maxCookMinutes, setMaxCookMinutes] = useState(mealType === "cook" ? 30 : 10);

  const available = useQuery(trpc.generation.available.queryOptions());
  const generate = useMutation(
    trpc.generation.generate.mutationOptions({
      onSuccess: () => {
        setOpen(false);
        onGenerated();
      },
    }),
  );

  if (!available.data?.configured) return null;

  if (!open) {
    return (
      <Button variant="ghost" onClick={() => setOpen(true)}>
        Generate with AI
      </Button>
    );
  }

  return (
    <div className="flex w-full flex-wrap items-end gap-2 rounded-lg border border-border bg-surface-sunken p-2">
      <Input
        aria-label="Cuisine"
        placeholder="Any cuisine"
        value={cuisine}
        onChange={(event) => setCuisine(event.target.value)}
        className="w-36"
      />
      <Select
        aria-label="Maximum cook minutes"
        value={maxCookMinutes}
        onChange={(event) => setMaxCookMinutes(Number(event.target.value))}
      >
        {[5, 10, 15, 20, 25, 30, 45].map((minutes) => (
          <option key={minutes} value={minutes}>
            &le; {minutes} min
          </option>
        ))}
      </Select>
      <Button
        variant="primary"
        disabled={generate.isPending}
        onClick={() =>
          generate.mutate({
            mealType,
            cuisine: cuisine.trim() || undefined,
            maxCookMinutes,
            targetDate,
            targetMeal,
          })
        }
      >
        {generate.isPending ? "Generating..." : "Generate"}
      </Button>
      <Button variant="ghost" onClick={() => setOpen(false)}>
        Cancel
      </Button>

      {generate.isError && (
        <p role="alert" className={cx("w-full text-xs", "text-warn")}>
          {generate.error.message}
        </p>
      )}
      {generate.data && (
        <p className="w-full text-xs text-accent">
          Created &ldquo;{generate.data.recipe.name}&rdquo; (${generate.data.costUsd.toFixed(4)},{" "}
          {generate.data.attempts} attempt{generate.data.attempts === 1 ? "" : "s"})
        </p>
      )}
    </div>
  );
}
