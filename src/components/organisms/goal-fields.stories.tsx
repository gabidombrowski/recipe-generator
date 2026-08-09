import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs";
import { DEFAULT_GOAL_ANSWERS, GoalFields, type GoalAnswers } from "./goal-fields";
import { DEFAULT_PROFILE, type Profile } from "~/lib/schemas";

/**
 * The wizard questionnaire that derives activity factor, deficit and protein.
 *
 * The traces underneath each answer are the component's reason for existing —
 * a recommendation you cannot argue with is just a hardcoded number with extra
 * steps. The safety clamp only becomes visible at an aggressive rate of loss on
 * a small frame, which is why that has its own story.
 */
const meta = {
  title: "Organisms/GoalFields",
  component: GoalFields,
  parameters: { layout: "padded" },
} satisfies Meta<typeof GoalFields>;

export default meta;
type Story = StoryObj<typeof meta>;

function Harness({ answers, profile }: { answers: GoalAnswers; profile: Profile }) {
  const [a, setA] = useState(answers);
  const [p, setP] = useState(profile);
  return (
    <div className="max-w-3xl">
      <GoalFields
        answers={a}
        profile={p}
        onChange={(next, derived) => {
          setA(next);
          setP({ ...p, ...derived });
        }}
      />
    </div>
  );
}

const harness = (args: { answers: GoalAnswers; profile: Profile }) => (
  <Harness answers={args.answers} profile={args.profile} />
);

/** Maintaining: no deficit, and the protein floor of the band. */
export const Maintaining: Story = {
  args: {
    answers: DEFAULT_GOAL_ANSWERS,
    profile: DEFAULT_PROFILE,
    onChange: () => undefined,
  },
  render: harness,
};

/** Losing at a moderate rate — the arithmetic runs unclamped. */
export const Losing: Story = {
  args: {
    answers: { ...DEFAULT_GOAL_ANSWERS, goal: "lose", rateKgPerWeek: 0.25 },
    profile: { ...DEFAULT_PROFILE, weightKg: 86, heightCm: 178 },
    onChange: () => undefined,
  },
  render: harness,
};

/**
 * The guard firing.
 *
 * A fast rate on a small, sedentary frame would prescribe an intake below BMR.
 * The deficit is reduced rather than refused, and the banner says why — the
 * alternative is silently disagreeing with the number someone asked for.
 */
export const DeficitClampedToBmr: Story = {
  args: {
    answers: {
      activity: { occupation: "desk", sessionsPerWeek: 0, sessionMinutes: 0 },
      goal: "lose",
      rateKgPerWeek: 1,
    },
    profile: { ...DEFAULT_PROFILE, weightKg: 50, heightCm: 155, activityFactor: 1.2 },
    onChange: () => undefined,
  },
  render: harness,
};

/** The app subtracts but never adds, so gaining has to say so plainly. */
export const Gaining: Story = {
  args: {
    answers: { ...DEFAULT_GOAL_ANSWERS, goal: "gain" },
    profile: DEFAULT_PROFILE,
    onChange: () => undefined,
  },
  render: harness,
};
