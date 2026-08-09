"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTRPC } from "~/trpc/react";
import { MacroExplainer } from "~/components/organisms/macro-explainer";
import { ProfileFields, SettingsFields } from "~/components/organisms/profile-fields";
import { CuisineFields } from "~/components/organisms/cuisine-fields";
import { MealFields } from "~/components/organisms/meal-fields";
import {
  DEFAULT_GOAL_ANSWERS,
  GoalFields,
  type GoalAnswers,
} from "~/components/organisms/goal-fields";
import {
  DEFAULT_MEAL_SHAPES,
  MealShapeFields,
  type MealShapeDraft,
} from "~/components/organisms/meal-shape-fields";
import { Button, PageTitle, Spinner } from "~/components/atoms";
import { Card } from "~/components/molecules";
import {
  DEFAULT_PROFILE,
  DEFAULT_SETTINGS,
  type Profile,
  type Settings,
} from "~/lib/schemas";

/**
 * First-run wizard.
 *
 * This is what a fresh clone sees. The committed defaults are deliberately
 * neutral placeholders — the real values come from here, or from a gitignored
 * `seed.local.json`, and never from the repository.
 *
 * Seven steps rather than one long form, and the order is deliberate: facts you
 * know about yourself, then the shape of your day and week, then the vocabulary the
 * planner speaks, and only then the numbers. The numbers come last because
 * their job is to tell you whether the earlier answers were right.
 *
 * It doubles as the re-run path from Settings, so every step seeds from what is
 * already stored rather than from the neutral defaults. Re-running to change one
 * meal shape must not silently reset a profile.
 */
export default function SetupPage() {
  const trpc = useTRPC();
  const router = useRouter();

  const state = useQuery(trpc.setup.state.queryOptions());

  const [step, setStep] = useState(0);

  const [profileDraft, setProfileDraft] = useState<Profile | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<Settings | null>(null);
  const [shapesDraft, setShapesDraft] = useState<MealShapeDraft[] | null>(null);
  // The questionnaire's own answers are wizard-local: only the three numbers
  // they produce are persisted, on the profile.
  const [goals, setGoals] = useState<GoalAnswers>(DEFAULT_GOAL_ANSWERS);

  const stored = state.data;

  const profile: Profile = profileDraft ?? stored?.profile ?? DEFAULT_PROFILE;
  const settings: Settings = settingsDraft ??
    stored?.settings ?? {
      ...DEFAULT_SETTINGS,
      timezone:
        Intl.DateTimeFormat().resolvedOptions().timeZone ||
        DEFAULT_SETTINGS.timezone,
    };
  const shapes: MealShapeDraft[] =
    shapesDraft ??
    (stored?.mealShapes.length ? stored.mealShapes : DEFAULT_MEAL_SHAPES);

  const preview = useQuery(trpc.setup.preview.queryOptions(profile));

  const complete = useMutation(
    trpc.setup.completeWizard.mutationOptions({
      onSuccess: () => router.replace("/"),
    }),
  );

  const STEPS = [
    "About you",
    "Goals",
    "Your day",
    "Schedule",
    "What meals mean",
    "Cuisines",
    "Check the numbers",
  ] as const;

  if (state.isPending) return <Spinner label="Loading your settings" />;

  return (
    <main className="mx-auto max-w-3xl space-y-5 px-4 py-8">
      <header>
        <PageTitle>Set up</PageTitle>
        <p className="mt-1 text-sm text-ink-muted">
          Nothing here ships in the repository. These values live only in your
          database.
        </p>
        <ol className="mt-4 flex flex-wrap gap-2 text-xs">
          {STEPS.map((label, index) => (
            <li
              key={label}
              aria-current={index === step ? "step" : undefined}
              className={
                index === step
                  ? "rounded-full bg-accent-soft px-3 py-1 font-medium text-accent"
                  : "rounded-full bg-surface-sunken px-3 py-1 text-ink-muted"
              }
            >
              {index + 1}. {label}
            </li>
          ))}
        </ol>
      </header>

      {step === 0 && (
        <Card title="About you">
          <ProfileFields
            value={profile}
            onChange={setProfileDraft}
            hideDerived
            units={settings.units}
          />
        </Card>
      )}

      {step === 1 && (
        <Card title="Goals and activity">
          <p className="mb-4 text-sm text-ink-muted">
            Three numbers drive every target this app produces: how active you
            are, how big a deficit to run, and how much protein to aim for.
            Rather than asking you to know them, these questions work them out —
            and show the arithmetic, so you can disagree with it.
          </p>
          <GoalFields
            answers={goals}
            profile={profile}
            onChange={(next, derived) => {
              setGoals(next);
              setProfileDraft({ ...profile, ...derived });
            }}
          />
        </Card>
      )}

      {step === 2 && (
        <Card title="Your day">
          <p className="mb-4 text-sm text-ink-muted">
            Which meals make up your day. The daily targets are divided across
            them, and one of them is the meal this app plans, shops for and
            builds leftovers around.
          </p>
          <MealFields
            meals={settings.meals}
            plannedMeals={settings.plannedMeals}
            mainMeal={settings.mainMeal}
            onChange={({ meals, plannedMeals, mainMeal }) =>
              setSettingsDraft({ ...settings, meals, plannedMeals, mainMeal })
            }
          />
        </Card>
      )}

      {step === 3 && (
        <Card title="Schedule and planning">
          <SettingsFields
            value={settings}
            onChange={setSettingsDraft}
            llmConfigured={stored?.llmConfigured ?? false}
          />
        </Card>
      )}

      {step === 4 && (
        <Card title="What meals mean">
          <p className="mb-4 text-sm text-ink-muted">
            The planner works in three kinds of meal. Say what each one means to
            you and the rest of the app follows: recipes are proposed to fit, a
            verifier rejects a week that breaks these, and the shopping list
            buys for the servings you set.
          </p>
          <MealShapeFields value={shapes} onChange={setShapesDraft} />
        </Card>
      )}

      {step === 5 && (
        <Card title="Cuisines">
          <p className="mb-4 text-sm text-ink-muted">
            The food this app will suggest. Edit it down to what you actually
            cook, or add anything missing — it is a starting point, not a fixed
            menu.
          </p>
          <CuisineFields
            value={settings.cuisines}
            onChange={(cuisines) => setSettingsDraft({ ...settings, cuisines })}
          />
        </Card>
      )}

      {step === 6 &&
        (preview.isPending ? (
          <Spinner label="Computing" />
        ) : preview.data ? (
          <>
            <p className="rounded-lg bg-surface-sunken px-3 py-2 text-sm text-ink-muted">
              These come straight from the values you entered. If a number looks
              wrong, step back and fix the input — nothing here is hardcoded,
              and every line below shows the arithmetic that produced it.
            </p>
            <MacroExplainer
              plan={preview.data.plan}
              formulas={preview.data.formulas}
              perMealProtein={preview.data.perMealProtein}
              mealSplit={preview.data.mealSplit}
            />
          </>
        ) : null)}

      <div className="flex items-center justify-between gap-2">
        <Button
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
        >
          Back
        </Button>

        {step < STEPS.length - 1 ? (
          <Button variant="primary" onClick={() => setStep((s) => s + 1)}>
            Next
          </Button>
        ) : (
          <Button
            variant="primary"
            disabled={complete.isPending}
            onClick={() =>
              complete.mutate({ profile, settings, mealShapes: shapes })
            }
          >
            {complete.isPending ? "Saving..." : "Finish setup"}
          </Button>
        )}
      </div>

      {complete.isError && (
        <p
          role="alert"
          className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn"
        >
          {complete.error.message}
        </p>
      )}
    </main>
  );
}
