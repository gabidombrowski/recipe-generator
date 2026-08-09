import type { Meta, StoryObj } from "@storybook/nextjs";
import { RecipeCard } from "./recipe-card";
import { SEED_RECIPES } from "~/server/db/seed-data";
import { type Recipe } from "~/lib/schemas";

/**
 * A recipe as the plan shows it.
 *
 * Built from the real seed library rather than invented fixtures, so the
 * stories exercise genuine ingredient counts, step lengths and tag mixes — the
 * things that actually break a layout.
 */
const meta = {
  title: "Organisms/RecipeCard",
  component: RecipeCard,
  parameters: { layout: "padded" },
} satisfies Meta<typeof RecipeCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Persisted fields the seed bodies do not carry. */
const asRecipe = (index: number, overrides: Partial<Recipe> = {}): Recipe => ({
  ...SEED_RECIPES[index]!,
  id: index + 1,
  favorite: false,
  tagCounts: {},
  source: "seed",
  promptHash: null,
  modelString: null,
  createdAt: "2026-01-01",
  ...overrides,
});

export const Collapsed: Story = {
  args: { recipe: asRecipe(0) },
};

export const Expanded: Story = {
  args: { recipe: asRecipe(0), defaultExpanded: true },
};

/** Saved to the library, which is the only thing the star means. */
export const Favourite: Story = {
  args: { recipe: asRecipe(1, { favorite: true }), defaultExpanded: true },
};

/** Carrying culinary tags, which the grocery list badges downstream. */
export const WithTags: Story = {
  args: {
    recipe: asRecipe(0, { tagCounts: { fermented: 2, spicy: 1 } }),
    defaultExpanded: true,
  },
};
