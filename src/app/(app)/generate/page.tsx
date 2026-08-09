"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "~/trpc/react";
import { RecipeCard } from "~/components/recipe-card";
import {
  Badge,
  Button,
  Card,
  Empty,
  Field,
  InfoHint,
  Input,
  PageTitle,
  Select,
  Spinner,
} from "~/components/ui";
import { formatLongDate } from "~/lib/days";
import { mealTypeSchema, type MealType, type Recipe } from "~/lib/schemas";

/**
 * The recipe generator.
 *
 * Its own tab rather than a button on the Library, because the two do opposite
 * things: the Library is what you have kept, and this makes something that does
 * not exist yet. Mixing them is what made "the library" mean "every recipe ever
 * generated", which is the distinction the saved-only filter restored.
 *
 * Nothing here is saved to the library on its own. A generated recipe is
 * written to the database — it has to be, the planner assigns by id — but it
 * only becomes part of the library when you save it. That means you can
 * generate three and keep one without curating a graveyard afterwards.
 */
export default function GeneratePage() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const available = useQuery(trpc.generation.available.queryOptions());
  const setup = useQuery(trpc.setup.state.queryOptions());
  const nextSlot = useQuery(trpc.plan.nextOpenSlot.queryOptions());
  const week = useQuery(trpc.plan.week.queryOptions({}));

  const [mealType, setMealType] = useState<MealType>("cook");
  const [cuisine, setCuisine] = useState("");
  const [maxCookMinutes, setMaxCookMinutes] = useState<number | "">("");
  const [note, setNote] = useState("");

  // The last generation stays on screen so it can be acted on. Generating
  // again replaces it — the previous one is still in the database, and turning
  // on "show unsaved" in the Library is how you find it.
  const [result, setResult] = useState<{ recipe: Recipe; costUsd: number; attempts: number } | null>(
    null,
  );
  const [done, setDone] = useState<string | null>(null);

  const invalidate = () => queryClient.invalidateQueries();

  const generate = useMutation(
    trpc.generation.generate.mutationOptions({
      onSuccess: (data) => {
        setResult({ recipe: data.recipe, costUsd: data.costUsd, attempts: data.attempts });
        setDone(null);
        invalidate();
      },
    }),
  );

  const save = useMutation(
    trpc.recipes.setFavorite.mutationOptions({
      onSuccess: () => {
        setDone("Saved to your library.");
        invalidate();
      },
    }),
  );

  const assign = useMutation(
    trpc.plan.assign.mutationOptions({
      onSuccess: () => {
        invalidate();
      },
    }),
  );

  if (available.isPending || setup.isPending) return <Spinner />;

  if (!available.data?.configured) {
    return (
      <div className="space-y-5">
        <PageTitle>Generate</PageTitle>
        <Empty>
          <code>ANTHROPIC_API_KEY</code> is not set, so recipe generation is
          unavailable. Everything else in the app works without it.
        </Empty>
      </div>
    );
  }

  const cuisines = setup.data?.settings.cuisines ?? [];

  /**
   * Every slot that can take a recipe: each planned meal on each day.
   *
   * Leftover slots are excluded for the same reason `nextOpenSlot` skips them —
   * they are eaten from the fridge and hold no recipe, so assigning into one
   * would look like it worked and change nothing.
   */
  const assignableSlots = (week.data?.days ?? []).flatMap((day) =>
    day.meals
      .filter((m) => m.mealSource !== "leftover")
      .map((m) => ({
        date: day.date,
        day: day.day,
        meal: m.meal,
        replaces: m.recipe?.name ?? null,
      })),
  );

  const assignTo = (date: string, meal: string, label: string) => {
    if (!result) return;
    assign.mutate({ date, meal, recipeId: result.recipe.id });
    setDone(`Assigned to ${label}.`);
  };

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <PageTitle>Generate</PageTitle>
          <p className="text-sm text-ink-muted">
            One recipe at a time, against your rules. Nothing is added to your
            library until you save it.
          </p>
        </div>
      </header>

      <Card title="What do you want?">
        <form
          className="flex flex-wrap items-start gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            generate.mutate({
              mealType,
              cuisine: cuisine.trim() || undefined,
              maxCookMinutes: maxCookMinutes === "" ? undefined : maxCookMinutes,
              note: note.trim() || undefined,
            });
          }}
        >
          <Field label="Kind of meal" hint="Sets the shape it must fit">
            <Select
              value={mealType}
              onChange={(event) => setMealType(event.target.value as MealType)}
            >
              {mealTypeSchema.options.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Cuisine" hint="Blank lets it choose">
            <Select value={cuisine} onChange={(event) => setCuisine(event.target.value)}>
              <option value="">Any</option>
              {cuisines.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Max minutes" hint="Blank uses your meal shape">
            <Input
              type="number"
              min="1"
              max="180"
              placeholder="any"
              value={maxCookMinutes}
              onChange={(event) =>
                setMaxCookMinutes(event.target.value === "" ? "" : Number(event.target.value))
              }
              className="w-28"
            />
          </Field>

          <Field label="Anything else?" hint="Optional, e.g. “use up the spinach”">
            <Input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="something warming"
              className="w-64"
            />
          </Field>

          <div className="flex flex-col gap-1">
            <span aria-hidden className="invisible text-sm font-medium select-none">
              &nbsp;
            </span>
            <Button type="submit" variant="primary" disabled={generate.isPending}>
              {generate.isPending ? "Generating..." : "Generate"}
            </Button>
          </div>
        </form>

        {generate.isError && (
          <p role="alert" className="mt-3 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
            {generate.error.message}
          </p>
        )}
      </Card>

      {generate.isPending && <Spinner label="Asking Claude" />}

      {result && (
        <>
          <RecipeCard recipe={result.recipe} defaultExpanded />

          <Card title="What now?">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                disabled={save.isPending || result.recipe.favorite}
                onClick={() => save.mutate({ id: result.recipe.id, favorite: true })}
              >
                {result.recipe.favorite ? "In your library" : "Save to library"}
              </Button>

              {nextSlot.data ? (
                <Button
                  disabled={assign.isPending}
                  onClick={() =>
                    assignTo(
                      nextSlot.data!.date,
                      nextSlot.data!.meal,
                      `${nextSlot.data!.meal} on ${nextSlot.data!.day}, ${formatLongDate(nextSlot.data!.date)}`,
                    )
                  }
                >
                  Use for {nextSlot.data.meal.toLowerCase()} on {nextSlot.data.day}
                </Button>
              ) : (
                <span className="text-xs text-ink-muted">
                  No open day in the next two weeks.
                </span>
              )}

              <Select
                aria-label="Assign to a specific day"
                value=""
                disabled={assign.isPending || assignableSlots.length === 0}
                onChange={(event) => {
                  const slot = assignableSlots.find((s) => `${s.date}|${s.meal}` === event.target.value);
                  if (slot) {
                    assignTo(
                      slot.date,
                      slot.meal,
                      `${slot.meal} on ${slot.day}, ${formatLongDate(slot.date)}`,
                    );
                  }
                }}
              >
                <option value="">Assign to a specific meal...</option>
                {assignableSlots.map((slot) => (
                  <option key={`${slot.date}|${slot.meal}`} value={`${slot.date}|${slot.meal}`}>
                    {slot.meal} — {slot.day} {formatLongDate(slot.date)}
                    {slot.replaces ? ` (replaces ${slot.replaces})` : ""}
                  </option>
                ))}
              </Select>

              <InfoHint>
                Assigning puts it straight into the weekly plan, and the grocery
                list picks it up on the next read. Saving and assigning are
                separate on purpose — a recipe you cook once does not have to
                live in your library forever.
              </InfoHint>
            </div>

            {done && <p className="mt-3 text-sm text-accent">{done}</p>}
            {assign.isError && (
              <p role="alert" className="mt-3 text-sm text-warn">
                {assign.error.message}
              </p>
            )}

            <p className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
              <Badge tone="neutral">${result.costUsd.toFixed(4)}</Badge>
              <Badge tone="neutral">
                {result.attempts} attempt{result.attempts === 1 ? "" : "s"}
              </Badge>
              Generated recipes are validated against your rules before they get
              this far — a proposal that breaks one is retried, not shown.
            </p>
          </Card>
        </>
      )}
    </div>
  );
}
