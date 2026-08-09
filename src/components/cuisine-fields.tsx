"use client";

import { useState } from "react";
import { Badge, Button, Input } from "./ui";
import { DEFAULT_CUISINES } from "~/lib/schemas";

/**
 * The cuisine palette.
 *
 * Cuisines used to come from two hardcoded lists — the ones attached to the
 * seeded recipes, and a separate rotation the AI filler drew from — so the set
 * of food this app would ever suggest was fixed by whoever wrote those arrays.
 * This makes it a list you own: the defaults are a starting point to edit down
 * to what you actually cook, or add to.
 *
 * Order is preserved rather than sorted, so a cuisine you just added stays
 * where you can see it instead of jumping into the middle of the list.
 */
export function CuisineFields({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  const add = () => {
    const name = draft.trim();
    if (!name) return;
    // Case-insensitive: "thai" under "Thai" is the same cuisine, and a
    // duplicate would show twice in every picker.
    if (value.some((c) => c.toLowerCase() === name.toLowerCase())) {
      setDraft("");
      return;
    }
    onChange([...value, name]);
    setDraft("");
  };

  const remove = (name: string) => onChange(value.filter((c) => c !== name));

  const missingDefaults = DEFAULT_CUISINES.filter(
    (d) => !value.some((c) => c.toLowerCase() === d.toLowerCase()),
  );

  return (
    <div className="space-y-3">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          add();
        }}
      >
        <Input
          aria-label="Add a cuisine"
          placeholder="Cuisine name"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          className="w-56"
        />
        <Button type="submit" variant="primary" disabled={!draft.trim()}>
          Add
        </Button>
        {value.length === 0 && (
          <Button type="button" onClick={() => onChange([...DEFAULT_CUISINES])}>
            Use the starter list
          </Button>
        )}
      </form>

      {value.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-ink-muted">
          No cuisines yet. Recipes can still use any cuisine — this list is what
          the pickers offer and what the AI filler rotates through.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {value.map((cuisine) => (
            <li key={cuisine}>
              <span className="inline-flex items-center gap-1 rounded-full bg-surface-sunken py-0.5 pr-1 pl-2.5 text-xs">
                {cuisine}
                <button
                  type="button"
                  aria-label={`Remove ${cuisine}`}
                  onClick={() => remove(cuisine)}
                  className="rounded-full px-1 text-ink-muted hover:text-warn"
                >
                  ×
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {value.length > 0 && missingDefaults.length > 0 && (
        <details className="text-xs text-ink-muted">
          <summary className="cursor-pointer">
            Add back from the starter list ({missingDefaults.length})
          </summary>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {missingDefaults.map((cuisine) => (
              <li key={cuisine}>
                <button type="button" onClick={() => onChange([...value, cuisine])}>
                  <Badge tone="accent">+ {cuisine}</Badge>
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
