import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs";
import {
  DEFAULT_MEAL_SHAPES,
  MealShapeFields,
  type MealShapeDraft,
} from "./meal-shape-fields";

/**
 * What "cook", "quick" and "assembly" mean.
 *
 * These are the vocabulary the whole planner runs on, so the component's job is
 * to make clear that a blank field means "no limit" rather than zero.
 */
const meta = {
  title: "Organisms/MealShapeFields",
  component: MealShapeFields,
  parameters: { layout: "padded" },
} satisfies Meta<typeof MealShapeFields>;

export default meta;
type Story = StoryObj<typeof meta>;

function Harness({ initial }: { initial: MealShapeDraft[] }) {
  const [value, setValue] = useState(initial);
  return (
    <div className="max-w-3xl">
      <MealShapeFields value={value} onChange={setValue} />
    </div>
  );
}

const harness = (args: { value: MealShapeDraft[] }) => <Harness initial={args.value} />;

/** Shipped defaults: servings set, cook time deliberately unbounded. */
export const Default: Story = {
  args: { value: DEFAULT_MEAL_SHAPES, onChange: () => undefined },
  render: harness,
};

/**
 * With time limits set, which is when the verifier starts rejecting recipes —
 * so the copy has to say these are enforced, not advisory.
 */
export const WithTimeLimits: Story = {
  args: {
    value: [
        { mealType: "cook", servings: 2, maxMinutes: 30 },
        { mealType: "quick", servings: 1, maxMinutes: 10 },
        { mealType: "assembly", servings: 1, maxMinutes: 5 },
      ],
    onChange: () => undefined,
  },
  render: harness,
};
