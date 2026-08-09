"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "~/trpc/react";
import { MacroExplainer } from "~/components/macro-explainer";
import { ProfileFields, SettingsFields } from "~/components/profile-fields";
import { CuisineFields } from "~/components/cuisine-fields";
import { MealFields } from "~/components/meal-fields";
import { Button, Card, Empty, InfoHint, PageTitle, Spinner } from "~/components/ui";
import { useRouter } from "next/navigation";
import { type Profile, type Settings } from "~/lib/schemas";

/**
 * Settings.
 *
 * Every Profile and Settings field is editable here. The macro panel is driven
 * by a live `preview` query against the values currently in the form, so the
 * numbers move as you type — before anything is saved.
 */
export default function SettingsPage() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const router = useRouter();

  const state = useQuery(trpc.setup.state.queryOptions());

  // Drafts overlay the server state rather than being seeded from it in an
  // effect: `draft ?? server` needs no synchronisation, so a background refetch
  // can never clobber what is being typed, and there is no cascading render.
  const [profileDraft, setProfileDraft] = useState<Profile | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<Settings | null>(null);

  const profile = profileDraft ?? state.data?.profile ?? null;
  const settings = settingsDraft ?? state.data?.settings ?? null;

  const preview = useQuery({
    ...trpc.setup.preview.queryOptions(profile!),
    enabled: profile !== null,
  });

  // Clearing the drafts on save is what lets the form fall back to the freshly
  // persisted values.
  const onSaved = () => {
    setProfileDraft(null);
    setSettingsDraft(null);
    void queryClient.invalidateQueries();
  };
  const saveProfile = useMutation(trpc.setup.saveProfile.mutationOptions({ onSuccess: onSaved }));
  const saveSettings = useMutation(trpc.setup.saveSettings.mutationOptions({ onSuccess: onSaved }));

  // Clearing `setupComplete` is what makes the app layout's gate send us to
  // /setup; the push is so it happens now rather than on the next navigation.
  const reopenWizard = useMutation(
    trpc.setup.reopenWizard.mutationOptions({ onSuccess: () => router.push("/setup") }),
  );

  if (state.isError) return <Empty>Could not load settings: {state.error.message}</Empty>;
  if (state.isPending || !profile || !settings || !state.data) return <Spinner />;

  const shown = preview.data ?? {
    plan: state.data.plan,
    formulas: state.data.formulas,
    perMealProtein: state.data.perMealProtein,
    mealSplit: state.data.mealSplit,
  };

  const dirty =
    JSON.stringify(profile) !== JSON.stringify(state.data.profile) ||
    JSON.stringify(settings) !== JSON.stringify(state.data.settings);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <PageTitle>Settings</PageTitle>
        <div className="flex items-center gap-2">
          {dirty && <span className="text-xs text-warn">unsaved changes</span>}
          <Button
            onClick={() => reopenWizard.mutate()}
            disabled={reopenWizard.isPending}
          >
            Re-run setup
          </Button>
          <InfoHint>
            Walks through the whole configuration again — profile, schedule, what
            each meal type means, and cuisines. Nothing is cleared: every step
            starts from what you have now.
          </InfoHint>
          <Button
            variant="primary"
            disabled={!dirty || saveProfile.isPending || saveSettings.isPending}
            onClick={() => {
              saveProfile.mutate(profile);
              saveSettings.mutate(settings);
            }}
          >
            Save
          </Button>
        </div>
      </header>

      {!state.data.llmConfigured && (
        <p className="rounded-lg bg-surface-sunken px-3 py-2 text-sm text-ink-muted">
          <code>ANTHROPIC_API_KEY</code> is not set, so AI generation and agentic
          planner mode are disabled. Everything else works.
        </p>
      )}

      <Card title="Profile">
        <ProfileFields value={profile} onChange={setProfileDraft} units={settings.units} />
      </Card>

      <MacroExplainer
        plan={shown.plan}
        formulas={shown.formulas}
        perMealProtein={shown.perMealProtein}
        mealSplit={shown.mealSplit}
      />

      <Card title="Schedule and planning">
        <SettingsFields
          value={settings}
          onChange={setSettingsDraft}
          llmConfigured={state.data.llmConfigured}
        />
      </Card>

      <Card title="Your day">
        <p className="mb-3 text-sm text-ink-muted">
          The meals you eat. Daily targets are divided across them, and the one
          marked below is what the weekly plan, grocery list and leftover cycle
          follow.
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

      <Card title="Cuisines">
        <p className="mb-3 text-sm text-ink-muted">
          What the cuisine pickers offer, and what the AI filler rotates through
          when it adds a novel recipe. Removing one never touches a recipe that
          already uses it.
        </p>
        <CuisineFields
          value={settings.cuisines}
          onChange={(cuisines) => setSettingsDraft({ ...settings, cuisines })}
        />
      </Card>
    </div>
  );
}
