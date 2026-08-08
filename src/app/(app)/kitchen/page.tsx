"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "~/trpc/react";
import { LeftoverList } from "~/components/leftover-list";
import { Badge, Button, Card, Empty, Field, Input, Select, Spinner } from "~/components/ui";

/**
 * Leftovers, the exclude list, and the pantry.
 *
 * Grouped because they are the three things that describe the state of the
 * kitchen rather than the plan, and all three change what the grocery list
 * says.
 */
export default function KitchenPage() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries();

  const leftovers = useQuery(trpc.kitchen.leftovers.queryOptions());
  const excluded = useQuery(trpc.kitchen.excluded.queryOptions());
  const pantry = useQuery(trpc.kitchen.pantry.queryOptions());

  const guidelines = useQuery(trpc.kitchen.guidelines.queryOptions());
  const [gTag, setGTag] = useState("");
  const [gMaxPerRecipe, setGMaxPerRecipe] = useState("");
  const [gMaxCookPerWeek, setGMaxCookPerWeek] = useState("");
  const [gNote, setGNote] = useState("");

  const addGuideline = useMutation(
    trpc.kitchen.addGuideline.mutationOptions({
      onSuccess: () => {
        setGTag("");
        setGMaxPerRecipe("");
        setGMaxCookPerWeek("");
        setGNote("");
        invalidate();
      },
    }),
  );
  const setGuidelineActive = useMutation(
    trpc.kitchen.setGuidelineActive.mutationOptions({ onSuccess: invalidate }),
  );
  const removeGuideline = useMutation(
    trpc.kitchen.removeGuideline.mutationOptions({ onSuccess: invalidate }),
  );

  const [newExclusion, setNewExclusion] = useState("");
  const [newStaple, setNewStaple] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualStorage, setManualStorage] = useState<"fridge" | "freezer">("fridge");

  const addExcluded = useMutation(trpc.kitchen.addExcluded.mutationOptions({ onSuccess: invalidate }));
  const removeExcluded = useMutation(trpc.kitchen.removeExcluded.mutationOptions({ onSuccess: invalidate }));
  const addStaple = useMutation(trpc.kitchen.addPantryStaple.mutationOptions({ onSuccess: invalidate }));
  const removeStaple = useMutation(trpc.kitchen.removePantryStaple.mutationOptions({ onSuccess: invalidate }));
  const setOnHand = useMutation(trpc.kitchen.setPantryOnHand.mutationOptions({ onSuccess: invalidate }));
  const storePortion = useMutation(trpc.kitchen.storePortion.mutationOptions({ onSuccess: invalidate }));

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">Kitchen</h1>

      <Card
        title="Leftovers"
        action={
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (!manualName.trim()) return;
              storePortion.mutate({ recipeName: manualName.trim(), storage: manualStorage });
              setManualName("");
            }}
          >
            <Input
              aria-label="Dish name"
              placeholder="Dish name"
              value={manualName}
              onChange={(event) => setManualName(event.target.value)}
              className="w-40"
            />
            <Select
              aria-label="Storage"
              value={manualStorage}
              onChange={(event) => setManualStorage(event.target.value as "fridge" | "freezer")}
            >
              <option value="fridge">fridge</option>
              <option value="freezer">freezer</option>
            </Select>
            <Button type="submit">Store 1 portion</Button>
          </form>
        }
      >
        {leftovers.isPending ? (
          <Spinner />
        ) : (
          <LeftoverList items={leftovers.data ?? []} onChanged={invalidate} />
        )}
      </Card>

      <Card title="Dietary guidelines">
        <p className="mb-3 text-xs text-ink-muted">
          Your own rules about what to cook. Cap how many ingredients carrying a
          culinary tag (<code>fermented</code>, <code>aged</code>,{" "}
          <code>cured</code>, <code>vinegar</code>…) may appear in one recipe or
          across a week, and add a note the recipe generator will follow. These
          live only in your database — nothing here is in the repository.
        </p>

        <form
          className="mb-4 grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-4"
          onSubmit={(event) => {
            event.preventDefault();
            addGuideline.mutate({
              tag: gTag.trim() || null,
              maxPerRecipe: gMaxPerRecipe === "" ? null : Number(gMaxPerRecipe),
              maxCookPerWeek: gMaxCookPerWeek === "" ? null : Number(gMaxCookPerWeek),
              note: gNote,
            });
          }}
        >
          <Field label="Tag" hint="optional">
            <Input
              value={gTag}
              onChange={(event) => setGTag(event.target.value)}
              placeholder="fermented"
            />
          </Field>
          <Field label="Max per recipe" hint="optional">
            <Input
              type="number"
              min="0"
              max="20"
              value={gMaxPerRecipe}
              onChange={(event) => setGMaxPerRecipe(event.target.value)}
            />
          </Field>
          <Field label="Max cook meals/week" hint="optional">
            <Input
              type="number"
              min="0"
              max="7"
              value={gMaxCookPerWeek}
              onChange={(event) => setGMaxCookPerWeek(event.target.value)}
            />
          </Field>
          <Field label="Note" hint="e.g. prefer coconut aminos to soy">
            <Input
              value={gNote}
              onChange={(event) => setGNote(event.target.value)}
              placeholder="avoid soy sauce"
            />
          </Field>
          <div className="sm:col-span-4">
            <Button type="submit" variant="primary" disabled={addGuideline.isPending}>
              Add guideline
            </Button>
            {addGuideline.isError && (
              <p role="alert" className="mt-2 text-xs text-warn">
                {addGuideline.error.message}
              </p>
            )}
          </div>
        </form>

        {guidelines.isPending ? (
          <Spinner />
        ) : (guidelines.data ?? []).length === 0 ? (
          <Empty>No guidelines yet.</Empty>
        ) : (
          <ul className="space-y-2">
            {guidelines.data!.map((g) => (
              <li
                key={g.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
              >
                <div className="min-w-0 text-sm">
                  {g.tag && (
                    <Badge tone="flagged">
                      {g.tag}
                      {g.maxPerRecipe !== null && ` · max ${g.maxPerRecipe}/recipe`}
                      {g.maxCookPerWeek !== null && ` · max ${g.maxCookPerWeek} cook/week`}
                    </Badge>
                  )}
                  {g.note && <span className="ml-2">{g.note}</span>}
                </div>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1.5 text-xs text-ink-muted">
                    <input
                      type="checkbox"
                      checked={g.active}
                      onChange={(event) =>
                        setGuidelineActive.mutate({ id: g.id, active: event.target.checked })
                      }
                      className="size-4 accent-[var(--color-accent)]"
                    />
                    active
                  </label>
                  <Button variant="danger" onClick={() => removeGuideline.mutate({ id: g.id })}>
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Excluded ingredients">
        <p className="mb-3 text-xs text-ink-muted">
          Matched case-insensitively against ingredient names and tags. Excluded
          items never appear on the grocery list, are passed to the AI generator,
          and are enforced by the scheduler and the planner verifier.
        </p>

        <form
          className="mb-3 flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!newExclusion.trim()) return;
            addExcluded.mutate({ name: newExclusion.trim() });
            setNewExclusion("");
          }}
        >
          <Input
            aria-label="Ingredient or seasoning to exclude"
            placeholder="e.g. soy sauce"
            value={newExclusion}
            onChange={(event) => setNewExclusion(event.target.value)}
            className="min-w-0 flex-1"
          />
          <Button type="submit" variant="primary" disabled={addExcluded.isPending}>
            Exclude
          </Button>
        </form>

        {excluded.isPending ? (
          <Spinner />
        ) : (excluded.data ?? []).length === 0 ? (
          <Empty>Nothing excluded.</Empty>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {excluded.data!.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => removeExcluded.mutate({ id: item.id })}
                  className="rounded-full bg-warn-soft px-2.5 py-1 text-xs font-medium text-warn hover:opacity-80"
                  aria-label={`Remove ${item.name} from the exclude list`}
                >
                  {item.name} ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Pantry staples">
        <p className="mb-3 text-xs text-ink-muted">
          Anything marked on hand collapses into the grocery list&rsquo;s
          &ldquo;check your supply&rdquo; section instead of being bought again.
        </p>

        <form
          className="mb-3 flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!newStaple.trim()) return;
            addStaple.mutate({ name: newStaple.trim() });
            setNewStaple("");
          }}
        >
          <Input
            aria-label="Pantry staple to add"
            placeholder="e.g. sesame oil"
            value={newStaple}
            onChange={(event) => setNewStaple(event.target.value)}
            className="min-w-0 flex-1"
          />
          <Button type="submit">Add</Button>
        </form>

        {pantry.isPending ? (
          <Spinner />
        ) : (
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {(pantry.data ?? []).map((staple) => (
              <li
                key={staple.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-1.5"
              >
                <label className="flex flex-1 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={staple.onHand}
                    onChange={(event) =>
                      setOnHand.mutate({ id: staple.id, onHand: event.target.checked })
                    }
                    className="size-4 accent-[var(--color-accent)]"
                  />
                  {staple.name}
                </label>
                {staple.onHand && <Badge tone="accent">on hand</Badge>}
                <button
                  type="button"
                  onClick={() => removeStaple.mutate({ id: staple.id })}
                  aria-label={`Remove ${staple.name}`}
                  className="text-ink-muted hover:text-warn"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
