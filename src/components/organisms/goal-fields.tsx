"use client";

import { Badge, Input, Select } from "~/components/atoms";
import { Field } from "~/components/molecules";
import {
  activityFactorFrom,
  GOAL_LABELS,
  goalSchema,
  OCCUPATION_LABELS,
  occupationLevelSchema,
  recommendDeficit,
  recommendProteinPerKg,
  type ActivityAnswers,
  type Goal,
} from "~/lib/recommendations";
import { type Profile } from "~/lib/schemas";

/**
 * The questions behind activity factor, calorie deficit and protein per kilo.
 *
 * Answering questions instead is the point, but the arithmetic stays visible:
 * each recommendation shows the steps that produced it, and writes into the
 * profile fields, which remain editable on the Settings page.
 */

export interface GoalAnswers {
  activity: ActivityAnswers;
  goal: Goal;
  /** Target rate of fat loss, kg per week. Ignored unless the goal is `lose`. */
  rateKgPerWeek: number;
}

export const DEFAULT_GOAL_ANSWERS: GoalAnswers = {
  activity: { occupation: "desk", sessionsPerWeek: 3, sessionMinutes: 45 },
  goal: "maintain",
  rateKgPerWeek: 0.5,
};

/**
 * One recommendation with the steps that produced it.
 *
 * Module scope, not defined inside `GoalFields`: a component created during
 * render is a new type on every keystroke, so React would unmount and remount
 * these three panels every time an answer changed.
 */
function Trace({
  title,
  steps,
  value,
}: {
  title: string;
  steps: string[];
  value: string;
}) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="plate plate--section text-xs">{title}</p>
        <Badge tone="accent">{value}</Badge>
      </div>
      <ol className="mt-2 space-y-0.5 font-mono text-xs text-ink-muted">
        {steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </div>
  );
}

export function GoalFields({
  answers,
  profile,
  onChange,
}: {
  answers: GoalAnswers;
  profile: Profile;
  onChange: (next: GoalAnswers, derived: Partial<Profile>) => void;
}) {
  const activity = activityFactorFrom(answers.activity);
  const deficit = recommendDeficit(
    { ...profile, activityFactor: activity.factor },
    answers.goal,
    answers.rateKgPerWeek,
  );
  const protein = recommendProteinPerKg({
    goal: answers.goal,
    sessionsPerWeek: answers.activity.sessionsPerWeek,
  });

  /** Recomputes all three numbers whenever any answer changes. */
  const update = (next: GoalAnswers) => {
    const a = activityFactorFrom(next.activity);
    const d = recommendDeficit(
      { ...profile, activityFactor: a.factor },
      next.goal,
      next.rateKgPerWeek,
    );
    const p = recommendProteinPerKg({
      goal: next.goal,
      sessionsPerWeek: next.activity.sessionsPerWeek,
    });
    onChange(next, {
      activityFactor: a.factor,
      deficitKcal: d.deficitKcal,
      proteinPerKg: p.proteinPerKg,
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Most days I am"
          hint="Everything that is not deliberate exercise"
        >
          <Select
            value={answers.activity.occupation}
            onChange={(event) =>
              update({
                ...answers,
                activity: {
                  ...answers.activity,
                  occupation: event.target
                    .value as ActivityAnswers["occupation"],
                },
              })
            }
          >
            {occupationLevelSchema.options.map((level) => (
              <option key={level} value={level}>
                {OCCUPATION_LABELS[level]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="What are you aiming for?">
          <Select
            value={answers.goal}
            onChange={(event) =>
              update({ ...answers, goal: event.target.value as Goal })
            }
          >
            {goalSchema.options.map((goal) => (
              <option key={goal} value={goal}>
                {GOAL_LABELS[goal]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Training sessions per week">
          <Input
            type="number"
            min="0"
            max="14"
            value={answers.activity.sessionsPerWeek}
            onChange={(event) =>
              update({
                ...answers,
                activity: {
                  ...answers.activity,
                  sessionsPerWeek: Number(event.target.value) || 0,
                },
              })
            }
          />
        </Field>

        <Field label="Typical session length" hint="minutes">
          <Input
            type="number"
            min="0"
            max="240"
            step="5"
            value={answers.activity.sessionMinutes}
            onChange={(event) =>
              update({
                ...answers,
                activity: {
                  ...answers.activity,
                  sessionMinutes: Number(event.target.value) || 0,
                },
              })
            }
          />
        </Field>

        {answers.goal === "lose" && (
          <Field
            label="Rate of loss"
            hint="kg per week — 0.25 to 0.5 is a common range"
          >
            <Input
              type="number"
              min="0"
              max="1"
              step="0.05"
              value={answers.rateKgPerWeek}
              onChange={(event) =>
                update({
                  ...answers,
                  rateKgPerWeek: Number(event.target.value) || 0,
                })
              }
            />
          </Field>
        )}
      </div>

      {deficit.warning && (
        <p
          role="alert"
          className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn"
        >
          {deficit.warning}
        </p>
      )}

      <div className="space-y-2">
        <Trace
          title="Activity factor"
          steps={activity.steps}
          value={activity.factor.toFixed(2)}
        />
        <Trace
          title="Daily deficit"
          steps={deficit.steps}
          value={`${deficit.deficitKcal} kcal`}
        />
        <Trace
          title="Protein"
          steps={protein.steps}
          value={`${protein.proteinPerKg.toFixed(1)} g/kg`}
        />
      </div>

      <p className="text-xs text-ink-muted">
        These are conventional starting points, not prescriptions — every one of
        them stays editable on the Settings page. Check them against what
        actually happens over a few weeks, and talk to a professional before
        running a large deficit or if you have a medical condition that bears on
        any of this.
      </p>
    </div>
  );
}
