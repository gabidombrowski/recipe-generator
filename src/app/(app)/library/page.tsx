"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "~/trpc/react";
import { RecipeCard } from "~/components/organisms/recipe-card";
import { AiFeedbackControls } from "~/components/connected/ai-feedback";
import { Badge, Button, Empty, Input, PageTitle, Select, Spinner } from "~/components/atoms";
import { Card, Field, InfoHint } from "~/components/molecules";
import { mealTypeSchema, type MealType } from "~/lib/schemas";

/**
 * The recipe library.
 *
 * Two search modes side by side: keyword, which is exact and instant, and
 * semantic, which understands "something cozy with chickpeas". The mode badge
 * says which one answered, because a semantic result that silently fell back to
 * keyword matching would be misleading.
 */
export default function LibraryPage() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [mealType, setMealType] = useState<MealType | "">("");
  const [cuisine, setCuisine] = useState("");
  const [maxCookMinutes, setMaxCookMinutes] = useState<number | "">("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [showUnsaved, setShowUnsaved] = useState(false);
  const [hideExcluded, setHideExcluded] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [semanticQuery, setSemanticQuery] = useState("");
  const [submittedSemantic, setSubmittedSemantic] = useState("");
  const [eatenKcal, setEatenKcal] = useState("");
  const [eatenProtein, setEatenProtein] = useState("");
  const [fitsOnly, setFitsOnly] = useState(false);

  const setup = useQuery(trpc.setup.state.queryOptions());
  const targets = setup.data?.plan.training;

  const filters = {
    mealType: mealType || undefined,
    cuisine: cuisine || undefined,
    maxCookMinutes: maxCookMinutes === "" ? undefined : maxCookMinutes,
    favoritesOnly,
    savedOnly: !showUnsaved,
    hideExcluded,
    keyword: keyword || undefined,
    eaten:
      fitsOnly && targets
        ? {
            kcal: Number(eatenKcal) || 0,
            proteinG: Number(eatenProtein) || 0,
            dayKcalTarget: targets.kcal,
            dayProteinTarget: targets.proteinG,
          }
        : undefined,
  };

  const library = useQuery(trpc.recipes.list.queryOptions(filters));
  const semantic = useQuery({
    ...trpc.recipes.semanticSearch.queryOptions({
      query: submittedSemantic,
      savedOnly: !showUnsaved,
    }),
    enabled: submittedSemantic.length > 0,
  });

  const invalidate = () => queryClient.invalidateQueries();
  const setFavorite = useMutation(
    trpc.recipes.setFavorite.mutationOptions({ onSuccess: invalidate }),
  );

  const excludedIds = new Set(library.data?.excludedRecipeIds ?? []);
  const showing = submittedSemantic
    ? (semantic.data?.recipes ?? [])
    : (library.data?.recipes ?? []);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <PageTitle>Library</PageTitle>
      </header>

      <Card title="Search">
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setSubmittedSemantic(semanticQuery.trim());
          }}
        >
          <Field label="Natural language">
            <Input
              value={semanticQuery}
              onChange={(event) => setSemanticQuery(event.target.value)}
              placeholder="something cozy with chickpeas"
              className="w-72"
            />
          </Field>
          <Button type="submit" variant="primary">
            Search
          </Button>
          {submittedSemantic && (
            <Button
              variant="ghost"
              type="button"
              onClick={() => {
                setSubmittedSemantic("");
                setSemanticQuery("");
              }}
            >
              Clear
            </Button>
          )}
          {semantic.data && (
            <Badge tone={semantic.data.mode === "semantic" ? "accent" : "warn"}>
              {semantic.data.mode === "semantic"
                ? "semantic search"
                : "keyword fallback (embeddings unavailable)"}
            </Badge>
          )}
        </form>
      </Card>

      <Card title="Filters">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Keyword">
            <Input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="garlic"
              className="w-40"
            />
          </Field>
          <Field label="Cuisine">
            <Select
              value={cuisine}
              onChange={(event) => setCuisine(event.target.value)}
            >
              <option value="">Any</option>
              {(library.data?.cuisines ?? []).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Meal type">
            <Select
              value={mealType}
              onChange={(event) =>
                setMealType((event.target.value as MealType) || "")
              }
            >
              <option value="">Any</option>
              {mealTypeSchema.options.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Max cook time">
            <Select
              value={maxCookMinutes}
              onChange={(event) =>
                setMaxCookMinutes(
                  event.target.value ? Number(event.target.value) : "",
                )
              }
            >
              <option value="">Any</option>
              {[5, 10, 15, 20, 30, 45].map((minutes) => (
                <option key={minutes} value={minutes}>
                  &le; {minutes} min
                </option>
              ))}
            </Select>
          </Field>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={favoritesOnly}
              onChange={(event) => setFavoritesOnly(event.target.checked)}
              className="size-4 accent-[var(--color-accent)]"
            />
            Favourites only
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={hideExcluded}
              onChange={(event) => setHideExcluded(event.target.checked)}
              className="size-4 accent-[var(--color-accent)]"
            />
            Hide excluded
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showUnsaved}
              onChange={(event) => setShowUnsaved(event.target.checked)}
              className="size-4 accent-[var(--color-accent)]"
            />
            Show unsaved AI recipes
            <InfoHint>
              The library lists recipes you kept. Generated ones are stored as
              soon as they are created, so they appear here only after you save
              them with the ☆ — tick this to browse the rest.
            </InfoHint>
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-border pt-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={fitsOnly}
              onChange={(event) => setFitsOnly(event.target.checked)}
              className="size-4 accent-[var(--color-accent)]"
            />
            Fits remaining macros
          </label>
          <Field label="Eaten so far (kcal)">
            <Input
              type="number"
              inputMode="numeric"
              value={eatenKcal}
              onChange={(event) => setEatenKcal(event.target.value)}
              disabled={!fitsOnly}
              className="w-24"
            />
          </Field>
          <Field label="Protein so far (g)">
            <Input
              type="number"
              inputMode="numeric"
              value={eatenProtein}
              onChange={(event) => setEatenProtein(event.target.value)}
              disabled={!fitsOnly}
              className="w-24"
            />
          </Field>
          {fitsOnly && targets && (
            <p className="text-xs text-ink-muted">
              Against a training day: {targets.kcal} kcal / {targets.proteinG} g
              protein.
            </p>
          )}
        </div>
      </Card>

      {library.isPending || (submittedSemantic && semantic.isPending) ? (
        <Spinner />
      ) : showing.length === 0 ? (
        <Empty>No recipes match.</Empty>
      ) : (
        <div className="grid gap-3">
          {showing.map((recipe) => (
            <RecipeCard
              key={recipe.id}
              recipe={recipe}
              hasExcluded={excludedIds.has(recipe.id)}
              onToggleFavorite={(favorite) =>
                setFavorite.mutate({ id: recipe.id, favorite })
              }
              actions={
                recipe.source === "ai" ? (
                  <AiFeedbackControls
                    recipeId={recipe.id}
                    onChanged={invalidate}
                  />
                ) : undefined
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
