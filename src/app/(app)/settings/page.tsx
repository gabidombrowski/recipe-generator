"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "~/trpc/react";
import { MacroExplainer } from "~/components/macro-explainer";
import { ProfileFields, SettingsFields } from "~/components/profile-fields";
import { Button, Card, Empty, Spinner } from "~/components/ui";
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

  if (state.isError) return <Empty>Could not load settings: {state.error.message}</Empty>;
  if (state.isPending || !profile || !settings || !state.data) return <Spinner />;

  const shown = preview.data ?? {
    plan: state.data.plan,
    formulas: state.data.formulas,
    perMealProtein: state.data.perMealProtein,
  };

  const dirty =
    JSON.stringify(profile) !== JSON.stringify(state.data.profile) ||
    JSON.stringify(settings) !== JSON.stringify(state.data.settings);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Settings</h1>
        <div className="flex items-center gap-2">
          {dirty && <span className="text-xs text-warn">unsaved changes</span>}
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
        <ProfileFields value={profile} onChange={setProfileDraft} />
      </Card>

      <MacroExplainer
        plan={shown.plan}
        formulas={shown.formulas}
        perMealProtein={shown.perMealProtein}
      />

      <Card title="Schedule and planning">
        <SettingsFields
          value={settings}
          onChange={setSettingsDraft}
          llmConfigured={state.data.llmConfigured}
        />
      </Card>
    </div>
  );
}
