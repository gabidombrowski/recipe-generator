"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "~/trpc/react";
import { RecipeCard } from "~/components/recipe-card";
import { Badge, Button, Card, Empty, MacroRow, Spinner } from "~/components/ui";
import { LeftoverList } from "~/components/leftover-list";

/**
 * Today.
 *
 * Answers the two questions that actually come up at 6pm: what kind of day is
 * this, and what am I eating. Day type (training/rest) and day role (cook,
 * leftover, assembly, quick) are detected from settings and both can be
 * overridden here without editing the profile.
 */
export default function TodayPage() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [trainingOverride, setTrainingOverride] = useState<boolean | null>(null);

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
          <h1 className="text-2xl font-semibold">{data.day}</h1>
          <p className="font-mono text-sm text-ink-muted">{data.date}</p>
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

      <Card
        title="Day role"
        action={
          <select
            aria-label="Override today's day role"
            className="rounded-lg border border-border bg-surface px-2 py-1 text-xs"
            value={data.role}
            onChange={(event) =>
              setMealSource.mutate({
                date: data.date,
                mealSource: event.target.value as typeof data.role,
              })
            }
          >
            {(["cook", "quick", "assembly", "leftover"] as const).map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
        }
      >
        <p className="text-sm">{data.guidance}</p>

        {data.role === "cook" && (
          <p className="mt-3 rounded-lg bg-accent-soft px-3 py-2 text-sm text-accent">
            Cook for two. Get the second portion into the fridge while you eat the
            first — not after.
          </p>
        )}

        {data.role === "leftover" && !data.yesterdayWasCookDay && (
          <p className="mt-3 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
            This is a leftover day, but yesterday was not a cook day. Check the
            inventory below before counting on a portion being there.
          </p>
        )}
      </Card>

      {data.recipe ? (
        <RecipeCard
          recipe={data.recipe}
          defaultExpanded
          actions={
            <Button
              onClick={() =>
                storePortion.mutate({
                  recipeName: data.recipe!.name,
                  storage: "fridge",
                })
              }
              disabled={storePortion.isPending}
            >
              Stored 1 portion
            </Button>
          }
        />
      ) : (
        <Empty>
          Nothing assigned for today. Pick something on the{" "}
          <a className="underline" href="/week">
            weekly plan
          </a>
          .
        </Empty>
      )}

      <Card title="Leftover inventory">
        <LeftoverList items={data.leftovers} onChanged={invalidate} />
      </Card>
    </div>
  );
}
