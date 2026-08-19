"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "~/trpc/react";
import { RecipeCard } from "~/components/organisms/recipe-card";
import { Badge, Button, Empty, PageTitle, Spinner } from "~/components/atoms";
import { Card, MacroRow } from "~/components/molecules";
import { formatLongDate } from "~/lib/days";
import { mealSourceLabel } from "~/lib/schemas";
import { LeftoverList } from "~/components/connected/leftover-list";

/**
 * Today.
 *
 * Answers the two questions that actually come up: what kind of day is
 * this, and what am I eating. Day type (training/rest) and day role (cook,
 * leftover, assembly, quick) are detected from settings and both can be
 * overridden here without editing the profile.
 */
export default function TodayPage() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [trainingOverride, setTrainingOverride] = useState<boolean | null>(
    null,
  );

  const today = useQuery(trpc.plan.today.queryOptions({ trainingOverride }));
  const invalidate = () => queryClient.invalidateQueries();

  const setMealSource = useMutation(
    trpc.plan.setMealSource.mutationOptions({ onSuccess: invalidate }),
  );
  const storePortion = useMutation(
    trpc.kitchen.storePortion.mutationOptions({ onSuccess: invalidate }),
  );

  if (today.isPending) return <Spinner />;
  if (today.isError) {
    return <Empty>Could not load today: {today.error.message}</Empty>;
  }

  const data = today.data;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <PageTitle>{data.day}</PageTitle>
          <p className="text-sm text-ink-muted">{formatLongDate(data.date)}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge tone={data.training ? "training" : "neutral"}>
            {data.training ? "training day" : "rest day"}
          </Badge>
          <Badge tone="accent">{data.role} day</Badge>
          {data.flaggedIngredients.length > 0 && (
            <Badge tone="flagged">
              {data.flaggedIngredients.length} flagged today
            </Badge>
          )}
        </div>
      </header>

      <Card title="Today's targets">
        <MacroRow {...data.targets} />
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <span className="text-xs text-ink-muted">
            Detected {data.training ? "training" : "rest"} from your profile.
          </span>
          <Button
            variant="ghost"
            onClick={() => setTrainingOverride(data.training ? false : true)}
          >
            Treat as {data.training ? "rest" : "training"} day
          </Button>
          {data.trainingIsOverridden && (
            <Button variant="ghost" onClick={() => setTrainingOverride(null)}>
              Reset
            </Button>
          )}
        </div>
      </Card>

      {data.meals.map((entry) => (
        <Card
          key={entry.meal}
          title={entry.meal}
          action={
            <select
              aria-label={`Override the day role for ${entry.meal}`}
              className="min-h-11 rounded-lg border border-border bg-surface px-2 py-1 text-base sm:min-h-0 sm:text-xs"
              value={entry.role}
              onChange={(event) =>
                setMealSource.mutate({
                  date: data.date,
                  meal: entry.meal,
                  mealSource: event.target.value as typeof entry.role,
                })
              }
            >
              {(
                ["cook", "quick", "assembly", "leftover", "eat_out"] as const
              ).map((role) => (
                <option key={role} value={role}>
                  {mealSourceLabel(role)}
                </option>
              ))}
            </select>
          }
        >
          <p className="text-sm">{entry.guidance}</p>

          {entry.role === "cook" && (
            <p className="mt-3 rounded-lg bg-accent-soft px-3 py-2 text-sm text-accent">
              Cook for two. Get the second portion into the fridge while you eat
              the first — not after.
            </p>
          )}

          {entry.role === "eat_out" && (
            <p className="mt-3 rounded-lg bg-accent-soft px-3 py-2 text-sm text-accent">
              Enjoy it. If you want a rough compass: the day&rsquo;s targets
              above still apply, but this is one meal out of a week of planned
              ones — one evening off plan is noise, not failure.
            </p>
          )}

          {entry.role === "leftover" && !data.yesterdayWasCookDay && (
            <p className="mt-3 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
              This is a leftover day, but yesterday was not a cook day. Check
              the inventory below before counting on a portion being there.
            </p>
          )}

          {entry.recipe ? (
            <div className="mt-3">
              <RecipeCard
                recipe={entry.recipe}
                defaultExpanded={entry.isMain}
                actions={
                  <Button
                    onClick={() =>
                      storePortion.mutate({
                        recipeName: entry.recipe!.name,
                        storage: "fridge",
                      })
                    }
                    disabled={storePortion.isPending}
                  >
                    Stored 1 portion
                  </Button>
                }
              />
            </div>
          ) : (
            entry.role !== "leftover" &&
            entry.role !== "eat_out" && (
              <p className="mt-3 rounded-lg border border-dashed border-border px-4 py-4 text-center text-sm text-ink-muted">
                Nothing assigned. Pick something on the{" "}
                <a className="underline" href="/week">
                  weekly plan
                </a>
                , or{" "}
                <a className="underline" href="/generate">
                  generate one
                </a>
                .
              </p>
            )
          )}
        </Card>
      ))}

      <Card title="Leftover inventory">
        <LeftoverList items={data.leftovers} onChanged={invalidate} />
      </Card>
    </div>
  );
}
