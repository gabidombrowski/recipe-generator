"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTRPC } from "~/trpc/react";
import { MacroExplainer } from "~/components/macro-explainer";
import { ProfileFields, SettingsFields } from "~/components/profile-fields";
import { Button, Card, Spinner } from "~/components/ui";
import { DEFAULT_PROFILE, DEFAULT_SETTINGS, type Profile, type Settings } from "~/lib/schemas";

/**
 * First-run wizard.
 *
 * This is what a fresh clone sees. The committed defaults are deliberately
 * neutral placeholders — the real values come from here, or from a gitignored
 * `seed.local.json`, and never from the repository.
 *
 * Three steps rather than one long form, because the third step (seeing the
 * macros the first two produce) is the one that tells you whether you entered
 * the right numbers.
 */
export default function SetupPage() {
  const trpc = useTRPC();
  const router = useRouter();

  const [step, setStep] = useState(0);
  const [profile, setProfile] = useState<Profile>(DEFAULT_PROFILE);
  const [settings, setSettings] = useState<Settings>({
    ...DEFAULT_SETTINGS,
    // Best guess from the browser; still fully editable.
    timezone:
      Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_SETTINGS.timezone,
  });

  const state = useQuery(trpc.setup.state.queryOptions());
  const preview = useQuery(trpc.setup.preview.queryOptions(profile));

  const complete = useMutation(
    trpc.setup.completeWizard.mutationOptions({
      onSuccess: () => router.replace("/"),
    }),
  );

  const STEPS = ["About you", "Schedule", "Check the numbers"] as const;

  return (
    <main className="mx-auto max-w-3xl space-y-5 px-4 py-8">
      <header>
        <h1 className="text-2xl font-semibold">Set up</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Nothing here ships in the repository. These values live only in your
          database.
        </p>
        <ol className="mt-4 flex gap-2 text-xs">
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
          <ProfileFields value={profile} onChange={setProfile} />
        </Card>
      )}

      {step === 1 && (
        <Card title="Schedule and planning">
          <SettingsFields
            value={settings}
            onChange={setSettings}
            llmConfigured={state.data?.llmConfigured ?? false}
          />
        </Card>
      )}

      {step === 2 &&
        (preview.isPending ? (
          <Spinner label="Computing" />
        ) : preview.data ? (
          <>
            <p className="rounded-lg bg-surface-sunken px-3 py-2 text-sm text-ink-muted">
              These come straight from the values you entered. If a number looks
              wrong, step back and fix the input — nothing here is hardcoded.
            </p>
            <MacroExplainer
              plan={preview.data.plan}
              formulas={preview.data.formulas}
              perMealProtein={preview.data.perMealProtein}
            />
          </>
        ) : null)}

      <div className="flex items-center justify-between gap-2">
        <Button onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
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
            onClick={() => complete.mutate({ profile, settings })}
          >
            {complete.isPending ? "Saving..." : "Finish setup"}
          </Button>
        )}
      </div>

      {complete.isError && (
        <p role="alert" className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
          {complete.error.message}
        </p>
      )}
    </main>
  );
}
