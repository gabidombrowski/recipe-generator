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

  const constraints = useQuery(trpc.kitchen.constraints.queryOptions());

  // One form for several constraint kinds: the fields that apply change with
  // the selected kind rather than showing every field for every rule.
  const [kind, setKind] = useState<"tag_cap" | "note" | "daily_staple">("tag_cap");
  const [tag, setTag] = useState("");
  const [maxPerRecipe, setMaxPerRecipe] = useState("");
  const [maxPerWeek, setMaxPerWeek] = useState("");
  const [note, setNote] = useState("");
  const [stapleName, setStapleName] = useState("");
  const [stapleQty, setStapleQty] = useState("");
  const [stapleUnit, setStapleUnit] = useState("g");

  const addConstraint = useMutation(
    trpc.kitchen.addConstraint.mutationOptions({
      onSuccess: () => {
        setTag("");
        setMaxPerRecipe("");
        setMaxPerWeek("");
        setNote("");
        setStapleName("");
        setStapleQty("");
        invalidate();
      },
    }),
  );
  const setConstraintActive = useMutation(
    trpc.kitchen.setConstraintActive.mutationOptions({ onSuccess: invalidate }),
  );
  const removeConstraint = useMutation(
    trpc.kitchen.removeConstraint.mutationOptions({ onSuccess: invalidate }),
  );

  const submitConstraint = () => {
    if (kind === "tag_cap") {
      addConstraint.mutate({
        kind: "tag_cap",
        tag: tag.trim(),
        maxPerRecipe: maxPerRecipe === "" ? null : Number(maxPerRecipe),
        maxPerWeek: maxPerWeek === "" ? null : Number(maxPerWeek),
      });
    } else if (kind === "note") {
      addConstraint.mutate({ kind: "note", text: note });
    } else {
      addConstraint.mutate({
        kind: "daily_staple",
        name: stapleName.trim(),
        qty: Number(stapleQty) || 1,
        unit: stapleUnit.trim() || "each",
      });
    }
  };

  const describe = (c: { kind: string } & Record<string, unknown>): string => {
    switch (c.kind) {
      case "tag_cap": {
        const caps = [
          c.maxPerRecipe !== null ? `max ${c.maxPerRecipe}/recipe` : null,
          c.maxPerWeek !== null ? `max ${c.maxPerWeek} cook meals/week` : null,
        ].filter(Boolean);
        return `${c.tag as string} — ${caps.join(", ")}`;
      }
      case "note":
        return c.text as string;
      case "daily_staple":
        return `${c.qty as number} ${c.unit as string} ${c.name as string} every day`;
      case "exclude_ingredient":
        return `never use ${c.name as string}`;
      case "meal_macros":
        return `${c.proteinMinG as number}-${c.proteinMaxG as number} g protein per serving`;
      case "meal_shape":
        return `${c.mealType as string}: ${c.servings ?? "any"} serving(s), up to ${c.maxMinutes ?? "any"} min`;
      case "ingredient_form":
        return `never ${(c.forbid as string[]).join("/")} ${(c.match as string[]).slice(0, 3).join(", ")}`;
      case "leftover_window":
        return `${c.storage as string}: eat within ${c.maxAgeDays ?? "any"} day(s)`;
      default:
        return c.kind;
    }
  };

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

      <Card title="Dietary rules">
        <p className="mb-3 text-xs text-ink-muted">
          Everything the app enforces is a rule you enter here — tag limits,
          notes for the recipe generator, and the staples added to every grocery
          list. They live only in your database; the repository ships none.
        </p>

        <form
          className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-border p-3"
          onSubmit={(event) => {
            event.preventDefault();
            submitConstraint();
          }}
        >
          <Field label="Rule type">
            <Select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
              <option value="tag_cap">Tag limit</option>
              <option value="note">Note for the generator</option>
              <option value="daily_staple">Daily staple</option>
            </Select>
          </Field>

          {kind === "tag_cap" && (
            <>
              <Field label="Tag">
                <Input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="fermented" className="w-36" />
              </Field>
              <Field label="Max per recipe" hint="optional">
                <Input type="number" min="0" max="20" value={maxPerRecipe} onChange={(e) => setMaxPerRecipe(e.target.value)} className="w-28" />
              </Field>
              <Field label="Max cook meals/week" hint="optional">
                <Input type="number" min="0" max="7" value={maxPerWeek} onChange={(e) => setMaxPerWeek(e.target.value)} className="w-28" />
              </Field>
            </>
          )}

          {kind === "note" && (
            <Field label="Note" hint="e.g. prefer coconut aminos to soy">
              <Input value={note} onChange={(e) => setNote(e.target.value)} className="w-80" placeholder="avoid soy sauce" />
            </Field>
          )}

          {kind === "daily_staple" && (
            <>
              <Field label="Item">
                <Input value={stapleName} onChange={(e) => setStapleName(e.target.value)} placeholder="oat milk" className="w-40" />
              </Field>
              <Field label="Qty per day">
                <Input type="number" step="0.25" min="0" value={stapleQty} onChange={(e) => setStapleQty(e.target.value)} className="w-24" />
              </Field>
              <Field label="Unit">
                <Input value={stapleUnit} onChange={(e) => setStapleUnit(e.target.value)} className="w-20" />
              </Field>
            </>
          )}

          <Button type="submit" variant="primary" disabled={addConstraint.isPending}>
            Add rule
          </Button>
          {addConstraint.isError && (
            <p role="alert" className="w-full text-xs text-warn">
              {addConstraint.error.message}
            </p>
          )}
        </form>

        {constraints.isPending ? (
          <Spinner />
        ) : (constraints.data ?? []).length === 0 ? (
          <Empty>No rules yet — the app enforces nothing until you add some.</Empty>
        ) : (
          <ul className="space-y-2">
            {constraints.data!.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
                <div className="flex min-w-0 items-center gap-2 text-sm">
                  <Badge tone="flagged">{c.constraint.kind.replace(/_/g, " ")}</Badge>
                  <span>{describe(c.constraint as never)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1.5 text-xs text-ink-muted">
                    <input
                      type="checkbox"
                      checked={c.active}
                      onChange={(e) => setConstraintActive.mutate({ id: c.id, active: e.target.checked })}
                      className="size-4 accent-[var(--color-accent)]"
                    />
                    active
                  </label>
                  <Button variant="danger" onClick={() => removeConstraint.mutate({ id: c.id })}>
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
