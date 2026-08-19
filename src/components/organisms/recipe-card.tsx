"use client";

import { useState } from "react";
import { Badge, Button } from "~/components/atoms";
import { Card, MacroRow } from "~/components/molecules";
import { cx } from "~/components/cx";
import { type Recipe } from "~/lib/schemas";

/**
 * A recipe, everywhere it appears.
 *
 * The badges are the point: cook time, meal type, and a count for any culinary
 * tag the user's dietary guidelines limit, so a recipe that breaches one can
 * never be scheduled by accident. Which tags those are is a runtime decision —
 * this component is handed the list rather than knowing it.
 */
export function RecipeCard({
  recipe,
  hasExcluded = false,
  flaggedTags = [],
  onToggleFavorite,
  actions,
  defaultExpanded = false,
}: {
  recipe: Recipe;
  hasExcluded?: boolean;
  /** Culinary tags an active dietary guideline limits. */
  flaggedTags?: readonly string[];
  onToggleFavorite?: (favorite: boolean) => void;
  actions?: React.ReactNode;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <Card className={cx(hasExcluded && "border-warn/40")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold">{recipe.name}</h3>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <Badge>{recipe.cuisine}</Badge>
            <Badge tone="accent">{recipe.mealType}</Badge>
            <Badge>{recipe.cookMinutes} min</Badge>
            <Badge>
              {recipe.servings} serving{recipe.servings === 1 ? "" : "s"}
            </Badge>
            {flaggedTags
              .filter((tag) => (recipe.tagCounts[tag] ?? 0) > 0)
              .map((tag) => (
                <Badge key={tag} tone="flagged">
                  {recipe.tagCounts[tag]} {tag}
                </Badge>
              ))}
            {recipe.source === "ai" && <Badge tone="accent">AI</Badge>}
            {hasExcluded && <Badge tone="warn">contains excluded</Badge>}
          </div>
        </div>

        {onToggleFavorite && (
          <button
            type="button"
            onClick={() => onToggleFavorite(!recipe.favorite)}
            aria-pressed={recipe.favorite}
            aria-label={
              recipe.favorite ? "Remove from favourites" : "Add to favourites"
            }
            className={cx(
              "shrink-0 rounded-lg px-2 py-1 text-lg transition",
              recipe.favorite
                ? "text-training"
                : "text-ink-muted hover:bg-surface-sunken",
            )}
          >
            {recipe.favorite ? "★" : "☆"}
          </button>
        )}
      </div>

      <div className="mt-3">
        <MacroRow {...recipe.macrosPerServing} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          variant="ghost"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Hide recipe" : "Show recipe"}
        </Button>
        {actions}
      </div>

      {expanded && (
        <div className="mt-4 grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
          <div>
            <h4 className="mb-2 text-xs font-semibold tracking-wide text-ink-muted uppercase">
              Ingredients
            </h4>
            <ul className="space-y-1 text-sm">
              {recipe.ingredients.map((ingredient) => {
                const flagged = ingredient.tags.filter((t) =>
                  flaggedTags.includes(t.toLowerCase()),
                );
                return (
                  <li
                    key={ingredient.name}
                    className="flex flex-wrap items-baseline gap-1.5"
                  >
                    <span className="font-mono text-xs tabular-nums text-ink-muted">
                      {ingredient.qty} {ingredient.unit}
                    </span>
                    <span>{ingredient.name}</span>
                    {flagged.map((t) => (
                      <Badge key={t} tone="flagged">
                        {t}
                      </Badge>
                    ))}
                  </li>
                );
              })}
            </ul>
          </div>
          <div>
            <h4 className="mb-2 text-xs font-semibold tracking-wide text-ink-muted uppercase">
              Steps
            </h4>
            <ol className="list-inside list-decimal space-y-1.5 text-sm">
              {recipe.steps.map((step, index) => (
                <li key={index}>{step}</li>
              ))}
            </ol>
            {recipe.modelString && (
              <p className="mt-4 font-mono text-xs text-ink-muted">
                {recipe.modelString}
                {recipe.promptHash ? ` · prompt ${recipe.promptHash}` : ""}
              </p>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
