"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useTRPC } from "~/trpc/react";
import { Badge, Button, Card, Empty, MacroRow, PageTitle, Spinner, cx } from "~/components/ui";
import { GenerateRecipeButton } from "~/components/generate-recipe";
import { formatLongDate, formatShortDate } from "~/lib/days";

/**
 * The weekly plan.
 *
 * Seven slots, each showing its day type, macro targets, role and assigned
 * recipe. Every mutation here invalidates the grocery list too, which is what
 * makes the summary card at the bottom trustworthy.
 */
export default function WeekPage() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const week = useQuery(trpc.plan.week.queryOptions({}));
  const library = useQuery(trpc.recipes.list.queryOptions({ favoritesOnly: false, hideExcluded: false }));
  const grocery = useQuery(trpc.grocery.list.queryOptions({}));

  const invalidate = () => queryClient.invalidateQueries();
  const assign = useMutation(trpc.plan.assign.mutationOptions({ onSuccess: invalidate }));
  const regenerate = useMutation(trpc.plan.regenerateSlot.mutationOptions({ onSuccess: invalidate }));
  const generateWeek = useMutation(trpc.plan.generateWeek.mutationOptions({ onSuccess: invalidate }));

  if (week.isPending) return <Spinner />;
  if (week.isError) return <Empty>Could not load the week: {week.error.message}</Empty>;

  const data = week.data;
  const lastRun = data.lastRuns[0];
  const recipes = library.data?.recipes ?? [];
  const groceryLineCount =
    (grocery.data?.sections.reduce((sum, s) => sum + s.lines.length, 0) ?? 0) +
    (grocery.data?.buyLater.length ?? 0);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <PageTitle>Week</PageTitle>
          <p className="text-sm text-ink-muted">
            Of {formatLongDate(data.weekStart)} · Planner mode:{" "}
            <strong>{data.plannerMode}</strong>
            {data.plannerMode === "ai" && !data.llmConfigured && " (no API key — running deterministically)"}
            {data.aiNovelRecipesPerWeek > 0 && ` · ${data.aiNovelRecipesPerWeek} AI recipe/week`}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="primary"
            onClick={() => generateWeek.mutate({ force: false })}
            disabled={generateWeek.isPending}
          >
            {generateWeek.isPending ? "Generating..." : "Generate week now"}
          </Button>
          <Button
            onClick={() => generateWeek.mutate({ force: true })}
            disabled={generateWeek.isPending}
            title="Re-plan every slot, including ones already assigned"
          >
            Force re-plan
          </Button>
        </div>
      </header>

      {generateWeek.data && (
        <p
          className={cx(
            "rounded-lg px-3 py-2 text-sm",
            generateWeek.data.status === "success"
              ? "bg-accent-soft text-accent"
              : "bg-surface-sunken text-ink-muted",
          )}
        >
          {generateWeek.data.status}: {generateWeek.data.message}
        </p>
      )}

      {/* A failed generation must say so — silence here would look like a
          no-op button rather than an error. */}
      {generateWeek.isError && (
        <p role="alert" className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
          Generation failed: {generateWeek.error.message}
        </p>
      )}
      {regenerate.data?.ok === false && (
        <p role="alert" className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
          {regenerate.data.message}
        </p>
      )}

      <div className="grid gap-3">
        {data.days.map((day) => (
          <Card
            key={day.date}
            className={cx(day.isToday && "border-accent")}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold">
                  {day.day}{" "}
                  <span className="font-normal text-ink-muted">
                    {formatShortDate(day.date)}
                  </span>
                </h2>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {day.isToday && <Badge tone="accent">today</Badge>}
                  <Badge tone={day.training ? "training" : "neutral"}>
                    {day.training ? "training" : "rest"}
                  </Badge>
                  {data.flaggedTags
                    .filter((tag) =>
                      day.meals.some((m) => (m.recipe?.tagCounts[tag] ?? 0) > 0),
                    )
                    .map((tag) => (
                      <Badge key={tag} tone="flagged">
                        {day.meals.reduce(
                          (n, m) => n + (m.recipe?.tagCounts[tag] ?? 0),
                          0,
                        )}{" "}
                        {tag}
                      </Badge>
                    ))}
                </div>
              </div>
              <MacroRow {...day.targets} />
            </div>

            {/* One row per planned meal. With a single planned meal this is the
                same single row the grid always had. */}
            <div className="mt-3 space-y-3">
              {day.meals.map((entry) => (
                <div
                  key={entry.meal}
                  className="rounded-lg border border-border p-2.5"
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="plate plate--section text-[10px]">{entry.meal}</span>
                    <Badge tone="accent">{entry.mealSource}</Badge>
                    {entry.mealSource !== entry.derivedMealSource && (
                      <Badge tone="warn">
                        overridden from {entry.derivedMealSource}
                      </Badge>
                    )}
                    {entry.recipe && (
                      <span className="text-xs text-ink-muted">
                        {entry.recipe.macrosPerServing.kcal} kcal ·{" "}
                        {entry.recipe.macrosPerServing.proteinG} g protein ·{" "}
                        {entry.recipe.cookMinutes} min
                      </span>
                    )}
                  </div>

                  {entry.mealSource === "leftover" ? (
                    <p className="rounded-lg bg-surface-sunken px-3 py-2 text-sm text-ink-muted">
                      Eating yesterday&rsquo;s refrigerated portion — nothing to
                      assign, and nothing added to the grocery list.
                    </p>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        aria-label={`Recipe for ${entry.meal} on ${day.date}`}
                        className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm"
                        value={entry.recipe?.id ?? ""}
                        onChange={(event) =>
                          assign.mutate({
                            date: day.date,
                            meal: entry.meal,
                            recipeId: event.target.value
                              ? Number(event.target.value)
                              : null,
                          })
                        }
                      >
                        <option value="">— nothing assigned —</option>
                        {recipes
                          .filter((r) => entry.eligibleMealTypes.includes(r.mealType))
                          .map((recipe) => (
                            <option key={recipe.id} value={recipe.id}>
                              {recipe.favorite ? "★ " : ""}
                              {recipe.name} · {recipe.cuisine} · {recipe.cookMinutes}m
                            </option>
                          ))}
                      </select>

                      <Button
                        onClick={() =>
                          regenerate.mutate({ date: day.date, meal: entry.meal })
                        }
                        disabled={regenerate.isPending}
                      >
                        Regenerate
                      </Button>

                      <GenerateRecipeButton
                        targetDate={day.date}
                        targetMeal={entry.meal}
                        mealType={
                          entry.mealSource === "quick"
                            ? "quick"
                            : entry.mealSource === "cook"
                              ? "cook"
                              : "assembly"
                        }
                        onGenerated={invalidate}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>

      <Card
        title="Grocery list"
        action={
          <Link href="/grocery" className="text-sm text-accent underline">
            Open
          </Link>
        }
      >
        {grocery.isPending ? (
          <Spinner label="Building" />
        ) : (
          <p className="text-sm">
            <strong>{groceryLineCount}</strong> line
            {groceryLineCount === 1 ? "" : "s"} for shopping day{" "}
            <strong>{grocery.data?.shoppingDay}</strong>
            {(grocery.data?.buyLater.length ?? 0) > 0 &&
              `, of which ${grocery.data!.buyLater.length} to buy later in the week`}
            .
          </p>
        )}
      </Card>

      <Card title="Scheduler runs">
        {data.lastRuns.length === 0 ? (
          <Empty>The scheduler has not run yet.</Empty>
        ) : (
          <ul className="space-y-2 text-sm">
            {data.lastRuns.map((run) => (
              <li key={run.id} className="rounded-lg border border-border px-3 py-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge
                    tone={
                      run.status === "success"
                        ? "accent"
                        : run.status === "failed"
                          ? "warn"
                          : "neutral"
                    }
                  >
                    {run.status}
                  </Badge>
                  <Badge>{run.mode}</Badge>
                  {run.fellBack && <Badge tone="warn">fell back</Badge>}
                  <span className="font-mono text-xs text-ink-muted">
                    {run.weekStart} · {run.startedAt}
                  </span>
                </div>
                <p className="mt-1 text-ink-muted">{run.message}</p>
                {run.verifierVerdicts.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5 text-xs">
                    {run.verifierVerdicts.map((verdict) => (
                      <li key={verdict.attempt} className="text-ink-muted">
                        proposal {verdict.attempt}:{" "}
                        {verdict.ok ? "accepted" : `rejected — ${verdict.reasons.join("; ")}`}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
        {lastRun?.fellBack && (
          <p className="mt-3 rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn">
            The agentic planner did not produce a verifiable week, so the
            deterministic planner ran instead. The week is still complete.
          </p>
        )}
      </Card>
    </div>
  );
}
