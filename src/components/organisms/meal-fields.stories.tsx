import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs";
import { MealFields } from "./meal-fields";

/**
 * The meals in a day, and which of them the app plans.
 *
 * Stateful, so the stories drive it through a wrapper rather than passing fixed
 * props: the interesting behaviour is what happens *between* states — removing
 * the main meal, or un-planning it — and a static prop set cannot show that.
 */
const meta = {
  title: "Organisms/MealFields",
  component: MealFields,
  parameters: { layout: "padded" },
} satisfies Meta<typeof MealFields>;

export default meta;
type Story = StoryObj<typeof meta>;

type Config = { meals: string[]; plannedMeals: string[]; mainMeal: string };

function Harness(initial: Config) {
  const [config, setConfig] = useState(initial);
  return (
    <div className="max-w-2xl space-y-4">
      <MealFields
        meals={config.meals}
        plannedMeals={config.plannedMeals}
        mainMeal={config.mainMeal}
        onChange={setConfig}
      />
      <pre className="rounded-lg bg-surface-sunken p-3 font-mono text-xs text-ink-muted">
        {JSON.stringify(config, null, 2)}
      </pre>
    </div>
  );
}

const harness = (args: Config) => <Harness {...args} />;

/** The shipped default: three meals, one of them planned. */
export const Default: Story = {
  args: {
    meals: ["Breakfast", "Lunch", "Dinner"],
    plannedMeals: ["Dinner"],
    mainMeal: "Dinner",
    onChange: () => undefined,
  },
  render: harness,
};

/** All three planned, which is what the multi-meal planner was built for. */
export const AllPlanned: Story = {
  args: {
    meals: ["Breakfast", "Lunch", "Dinner"],
    plannedMeals: ["Breakfast", "Lunch", "Dinner"],
    mainMeal: "Dinner",
    onChange: () => undefined,
  },
  render: harness,
};

/**
 * Try removing "Dinner" here, or un-ticking it above.
 *
 * The main meal has to move, because the cook cycle can only belong to a meal
 * that is actually planned — a dangling `mainMeal` produces no error anywhere,
 * the scheduler just plans a week with a hole in it. The JSON below shows the
 * repair as it happens.
 */
export const MainMealMovesWhenRemoved: Story = {
  args: {
    meals: ["Breakfast", "Lunch", "Dinner"],
    plannedMeals: ["Lunch", "Dinner"],
    mainMeal: "Dinner",
    onChange: () => undefined,
  },
  render: harness,
};

/** The empty state, which has to warn rather than silently divide by zero. */
export const NoMeals: Story = {
  args: {
    meals: [],
    plannedMeals: [],
    mainMeal: "",
    onChange: () => undefined,
  },
  render: harness,
};
