"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "~/trpc/react";
import { RecipeCard } from "~/components/organisms/recipe-card";
import {
  announce,
  Badge,
  Button,
  Empty,
  Input,
  PageTitle,
  Select,
  Spinner,
} from "~/components/atoms";
import { Card, Field, InfoHint } from "~/components/molecules";
import { formatLongDate } from "~/lib/days";
import { mealTypeSchema, type MealType, type Recipe } from "~/lib/schemas";
import { parseSse } from "~/lib/sse";

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

  // Polls only while a fill is running, so an idle page is not chatty.
  const coverage = useQuery({
    ...trpc.generation.libraryCoverage.queryOptions(),
    refetchInterval: (query) =>
      query.state.data?.status.running ? 2000 : false,
  });
  const fillLibrary = useMutation(
    trpc.generation.fillLibrary.mutationOptions({
      onSuccess: () => coverage.refetch(),
    }),
  );
  const week = useQuery(trpc.plan.week.queryOptions({}));

  const [mealType, setMealType] = useState<MealType>("cook");
  const [cuisine, setCuisine] = useState("");
  const [maxCookMinutes, setMaxCookMinutes] = useState<number | "">("");
  const [note, setNote] = useState("");

  // The last generation stays on screen so it can be acted on. Generating
  // again replaces it — the previous one is still in the database, and turning
  // on "show unsaved" in the Library is how you find it.
  const [result, setResult] = useState<{
    recipe: Recipe;
    costUsd: number;
    attempts: number;
  } | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const invalidate = () => queryClient.invalidateQueries();

  /**
   * Generation streams over SSE (`/api/generate/stream`) rather than going
   * through the tRPC mutation the week page uses: the recipe is on screen as
   * it is written instead of after a silent half minute. fetch + a stream
   * reader rather than EventSource because the request is a POST with a body,
   * which EventSource cannot send. No auto-reconnect on a dropped stream, on
   * purpose — a generation is not idempotent, and a reconnect would be a
   * second bill rather than a resumed first one; the user retries instead.
   */
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [attempt, setAttempt] = useState(1);
  const [streamError, setStreamError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Leaving the page cancels the model call instead of billing it out.
  useEffect(() => () => abortRef.current?.abort(), []);

  async function startGeneration(input: {
    mealType: MealType;
    cuisine?: string;
    maxCookMinutes?: number;
    note?: string;
  }): Promise<void> {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStreaming(true);
    setStreamText("");
    setAttempt(1);
    setStreamError(null);

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/generate/stream`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
          signal: controller.signal,
        },
      );

      if (!response.ok || !response.body) {
        const failure = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        setStreamError(
          failure?.error ?? `Generation failed (${response.status}).`,
        );
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done: finished, value } = await reader.read();
        if (finished) break;
        const parsed = parseSse(
          buffer,
          decoder.decode(value, { stream: true }),
        );
        buffer = parsed.rest;

        for (const event of parsed.events) {
          if (event.event === "attempt") {
            const { n } = event.data as { n: number };
            setAttempt(n);
            if (n > 1) setStreamText("");
          } else if (event.event === "delta") {
            setStreamText(
              (text) => text + (event.data as { text: string }).text,
            );
          } else if (event.event === "done") {
            const data = event.data as {
              recipe: Recipe;
              costUsd: number;
              attempts: number;
            };
            setResult(data);
            setDone(null);
            invalidate();
            announce(`Recipe ready: ${data.recipe.name}`);
          } else if (event.event === "error") {
            setStreamError((event.data as { message: string }).message);
          }
        }
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setStreamError("The stream dropped before the recipe finished.");
      }
    } finally {
      setStreaming(false);
    }
  }

  const save = useMutation(
    trpc.recipes.setFavorite.mutationOptions({
      onSuccess: () => {
        setDone("Saved to your library.");
        invalidate();
        announce("Saved to your library");
      },
    }),
  );

  const assign = useMutation(
    trpc.plan.assign.mutationOptions({
      onSuccess: () => {
        invalidate();
        announce("Assigned to the plan");
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
          unavailable.
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
      .filter((m) => m.mealSource !== "leftover" && m.mealSource !== "eat_out")
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

      {coverage.data &&
        (coverage.data.uncovered.length > 0 ||
          coverage.data.status.running) && (
          <Card title="Fill out your library">
            {coverage.data.status.running ? (
              <>
                <p className="text-sm">
                  Generating one recipe per cuisine —{" "}
                  <strong>
                    {coverage.data.status.completed} of{" "}
                    {coverage.data.status.total}
                  </strong>{" "}
                  done. This runs in the background; you can leave the page.
                </p>
                <div
                  className="mt-3 h-2 overflow-hidden rounded-full bg-surface-sunken"
                  role="progressbar"
                  aria-valuenow={coverage.data.status.completed}
                  aria-valuemin={0}
                  aria-valuemax={coverage.data.status.total}
                >
                  <div
                    className="h-full bg-accent transition-all"
                    style={{
                      width: `${Math.round(
                        (coverage.data.status.completed /
                          Math.max(1, coverage.data.status.total)) *
                          100,
                      )}%`,
                    }}
                  />
                </div>
                <p className="mt-2 text-xs text-ink-muted">
                  ${coverage.data.status.costUsd.toFixed(4)} so far
                  {coverage.data.status.failed.length > 0 &&
                    ` · ${coverage.data.status.failed.length} cuisine(s) failed and were skipped`}
                </p>
              </>
            ) : (
              <>
                <p className="text-sm">
                  {coverage.data.uncovered.length} cuisine
                  {coverage.data.uncovered.length === 1 ? "" : "s"} in your list
                  have no recipe yet:{" "}
                  <span className="text-ink-muted">
                    {coverage.data.uncovered.join(", ")}
                  </span>
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button
                    variant="primary"
                    onClick={() => fillLibrary.mutate()}
                    disabled={fillLibrary.isPending}
                  >
                    Generate one recipe for each
                  </Button>
                  <InfoHint>
                    One model call per cuisine, run in the background — the app
                    stays usable and you can leave this page. Nothing happens on
                    first boot: the committed library already covers every
                    default cuisine, and spending your API budget uninvited
                    would be rude. Recipes land unsaved, so they appear in the
                    Library only once you keep them.
                  </InfoHint>
                </div>
                {coverage.data.status.error && (
                  <p className="mt-2 text-xs text-ink-muted">
                    {coverage.data.status.error}
                  </p>
                )}
                {coverage.data.status.finishedAt &&
                  coverage.data.status.created.length > 0 && (
                    <p className="mt-2 text-xs text-accent">
                      Last run added {coverage.data.status.created.length}{" "}
                      recipe(s) for ${coverage.data.status.costUsd.toFixed(4)}.
                    </p>
                  )}
              </>
            )}
          </Card>
        )}

      <Card title="What do you want?">
        <form
          className="flex flex-wrap items-start gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void startGeneration({
              mealType,
              cuisine: cuisine.trim() || undefined,
              maxCookMinutes:
                maxCookMinutes === "" ? undefined : maxCookMinutes,
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
            <Select
              value={cuisine}
              onChange={(event) => setCuisine(event.target.value)}
            >
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
                setMaxCookMinutes(
                  event.target.value === "" ? "" : Number(event.target.value),
                )
              }
              className="w-28"
            />
          </Field>

          <Field
            label="Anything else?"
            hint="Optional, e.g. “use up the spinach”"
          >
            <Input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="something warming"
              className="w-64"
            />
          </Field>

          <div className="flex flex-col gap-1">
            <span
              aria-hidden
              className="invisible text-sm font-medium select-none"
            >
              &nbsp;
            </span>
            <Button type="submit" variant="primary" disabled={streaming}>
              {streaming ? "Generating..." : "Generate"}
            </Button>
          </div>
        </form>

        {streamError && (
          <p
            role="alert"
            className="mt-3 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn"
          >
            {streamError}
          </p>
        )}
      </Card>

      {streaming && (
        <Card title={attempt > 1 ? `Writing (attempt ${attempt})` : "Writing"}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm">
                {/* The name is the first field the model writes, so it is
                    usually readable long before the recipe finishes. */}
                {/"name"\s*:\s*"([^"]+)/.exec(streamText)?.[1] ?? "…"}
              </p>
              <pre
                aria-hidden
                className="mt-2 max-h-24 overflow-hidden font-mono text-xs break-all whitespace-pre-wrap text-ink-muted"
              >
                {streamText.slice(-360) || "waiting for the first tokens"}
              </pre>
              <p className="mt-1 text-xs text-ink-muted">
                {streamText.length.toLocaleString()} characters so far
              </p>
            </div>
            <Button variant="ghost" onClick={() => abortRef.current?.abort()}>
              Cancel
            </Button>
          </div>
        </Card>
      )}

      {result && (
        <>
          <RecipeCard recipe={result.recipe} defaultExpanded />

          <Card title="What now?">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                disabled={save.isPending || result.recipe.favorite}
                onClick={() =>
                  save.mutate({ id: result.recipe.id, favorite: true })
                }
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
                  Use for {nextSlot.data.meal.toLowerCase()} on{" "}
                  {nextSlot.data.day}
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
                  const slot = assignableSlots.find(
                    (s) => `${s.date}|${s.meal}` === event.target.value,
                  );
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
                  <option
                    key={`${slot.date}|${slot.meal}`}
                    value={`${slot.date}|${slot.meal}`}
                  >
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
