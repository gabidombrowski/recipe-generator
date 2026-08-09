import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs";
import { CuisineFields } from "./cuisine-fields";
import { DEFAULT_CUISINES } from "~/lib/schemas";

/**
 * The cuisine palette.
 *
 * Worth seeing at both extremes: the full starter list is long enough that the
 * chip layout has to wrap gracefully, and the empty state has to offer a way
 * back rather than stranding someone who cleared it.
 */
const meta = {
  title: "Organisms/CuisineFields",
  component: CuisineFields,
  parameters: { layout: "padded" },
} satisfies Meta<typeof CuisineFields>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Args seed the initial state rather than being passed straight through: the
 * component is controlled, so a story that only passed `value` would render a
 * list nothing could edit.
 */
function Harness({ initial }: { initial: string[] }) {
  const [value, setValue] = useState(initial);
  return (
    <div className="max-w-3xl">
      <CuisineFields value={value} onChange={setValue} />
    </div>
  );
}

const harness = (args: { value: string[] }) => <Harness initial={args.value} />;

/** The 22 shipped defaults — the wrapping case. */
export const StarterList: Story = {
  args: { value: [...DEFAULT_CUISINES], onChange: () => undefined },
  render: harness,
};

/** Edited down to what someone actually cooks. */
export const Trimmed: Story = {
  args: { value: ["Italian", "Japanese", "Mexican"], onChange: () => undefined },
  render: harness,
};

/** Cleared. The "add back from the starter list" affordance is the point. */
export const Empty: Story = {
  args: { value: [], onChange: () => undefined },
  render: harness,
};
