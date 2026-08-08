"use client";

import { DayPicker, Field, Input, Select } from "./ui";
import { formatHeight, formatWeight, kgToLb, lbToKg } from "~/lib/units";
import {
  DAYS_OF_WEEK,
  type DayOfWeek,
  type Profile,
  type Settings,
} from "~/lib/schemas";

/**
 * The Profile and Settings form fields.
 *
 * Shared between the Settings page and the first-run wizard so the two can
 * never disagree about what is editable — the spec's "every field editable,
 * nothing hardcoded" only holds if there is one definition of the form.
 */

const IANA_ZONES = [
  "UTC",
  "America/Chicago",
  "America/New_York",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Tokyo",
  "Australia/Sydney",
] as const;

export function ProfileFields({
  value,
  onChange,
}: {
  value: Profile;
  onChange: (next: Profile) => void;
}) {
  const set = <K extends keyof Profile>(key: K, next: Profile[K]) =>
    onChange({ ...value, [key]: next });

  const num = (raw: string, fallback: number) =>
    raw === "" ? fallback : Number(raw);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Weight is stored in kg but editable in either unit — the app shows
            both everywhere, so it would be odd to only accept one. */}
        <Field label="Weight (kg)" hint={formatWeight(value.weightKg)}>
          <Input
            type="number"
            step="0.1"
            min="1"
            value={value.weightKg}
            onChange={(event) => set("weightKg", num(event.target.value, value.weightKg))}
          />
        </Field>
        <Field label="Weight (lb)" hint="Same value, other unit">
          <Input
            type="number"
            step="0.1"
            min="1"
            value={Number(kgToLb(value.weightKg).toFixed(1))}
            onChange={(event) =>
              set("weightKg", Number(lbToKg(num(event.target.value, kgToLb(value.weightKg))).toFixed(2)))
            }
          />
        </Field>

        <Field label="Height (cm)" hint={formatHeight(value.heightCm)}>
          <Input
            type="number"
            step="0.1"
            min="1"
            value={value.heightCm}
            onChange={(event) => set("heightCm", num(event.target.value, value.heightCm))}
          />
        </Field>
        <Field label="Age">
          <Input
            type="number"
            min="1"
            value={value.age}
            onChange={(event) => set("age", num(event.target.value, value.age))}
          />
        </Field>

        <Field label="Sex" hint="Selects the Mifflin-St Jeor constant">
          <Select
            value={value.sex}
            onChange={(event) => set("sex", event.target.value as Profile["sex"])}
          >
            <option value="female">female</option>
            <option value="male">male</option>
          </Select>
        </Field>
        <Field label="Activity factor" hint="1.2 sedentary → 1.9 very active">
          <Input
            type="number"
            step="0.01"
            min="1"
            max="2.5"
            value={value.activityFactor}
            onChange={(event) =>
              set("activityFactor", num(event.target.value, value.activityFactor))
            }
          />
        </Field>

        <Field label="Daily deficit (kcal)" hint="Subtracted from TDEE">
          <Input
            type="number"
            min="0"
            value={value.deficitKcal}
            onChange={(event) => set("deficitKcal", num(event.target.value, value.deficitKcal))}
          />
        </Field>
        <Field
          label="Protein per kg"
          hint={`${Math.round(value.proteinPerKg * value.weightKg)} g/day`}
        >
          <Input
            type="number"
            step="0.1"
            min="0"
            value={value.proteinPerKg}
            onChange={(event) =>
              set("proteinPerKg", num(event.target.value, value.proteinPerKg))
            }
          />
        </Field>

        <Field
          label="Fat per kg"
          hint={`${Math.round(value.fatPerKg * value.weightKg)} g/day`}
        >
          <Input
            type="number"
            step="0.1"
            min="0"
            value={value.fatPerKg}
            onChange={(event) => set("fatPerKg", num(event.target.value, value.fatPerKg))}
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Training days" hint="Higher-calorie days">
          <DayPicker
            days={DAYS_OF_WEEK}
            selected={value.trainingDays}
            onChange={(next) => set("trainingDays", next as DayOfWeek[])}
          />
        </Field>
        <Field label="Cook days" hint="Cook double; next day is a leftover day">
          <DayPicker
            days={DAYS_OF_WEEK}
            selected={value.cookDays}
            onChange={(next) => set("cookDays", next as DayOfWeek[])}
          />
        </Field>
        <Field label="Assembly days" hint="No-cook days, alternating with quick">
          <DayPicker
            days={DAYS_OF_WEEK}
            selected={value.assemblyDays}
            onChange={(next) => set("assemblyDays", next as DayOfWeek[])}
          />
        </Field>
      </div>
    </div>
  );
}

export function SettingsFields({
  value,
  onChange,
  llmConfigured,
}: {
  value: Settings;
  onChange: (next: Settings) => void;
  llmConfigured: boolean;
}) {
  const set = <K extends keyof Settings>(key: K, next: Settings[K]) =>
    onChange({ ...value, [key]: next });

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Shopping day" hint="Shown at the top of the grocery list">
        <Select
          value={value.shoppingDay}
          onChange={(event) => set("shoppingDay", event.target.value as DayOfWeek)}
        >
          {DAYS_OF_WEEK.map((day) => (
            <option key={day} value={day}>
              {day}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Generation day" hint="Also the first day of the planned week">
        <Select
          value={value.generationDay}
          onChange={(event) => set("generationDay", event.target.value as DayOfWeek)}
        >
          {DAYS_OF_WEEK.map((day) => (
            <option key={day} value={day}>
              {day}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Generation time" hint="24-hour, in the timezone below">
        <Input
          type="time"
          value={value.generationTime}
          onChange={(event) => set("generationTime", event.target.value)}
        />
      </Field>
      <Field label="Timezone" hint="Drives the cron and all date arithmetic">
        <Select
          value={value.timezone}
          onChange={(event) => set("timezone", event.target.value)}
        >
          {[...new Set([value.timezone, ...IANA_ZONES])].map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label="AI recipes per week"
        hint={llmConfigured ? "Novel cook recipes generated each week" : "Requires ANTHROPIC_API_KEY"}
      >
        <Input
          type="number"
          min="0"
          max="7"
          disabled={!llmConfigured}
          value={value.aiNovelRecipesPerWeek}
          onChange={(event) =>
            set("aiNovelRecipesPerWeek", Number(event.target.value) || 0)
          }
        />
      </Field>
      <Field label="Repeat window (weeks)" hint="Don't reuse a recipe within this window">
        <Input
          type="number"
          min="0"
          max="52"
          value={value.repeatWindowWeeks}
          onChange={(event) => set("repeatWindowWeeks", Number(event.target.value) || 0)}
        />
      </Field>

      <Field
        label="Planner mode"
        hint={
          llmConfigured
            ? "AI mode proposes a week; a deterministic verifier accepts or rejects it"
            : "Requires ANTHROPIC_API_KEY"
        }
      >
        <Select
          value={value.plannerMode}
          disabled={!llmConfigured}
          onChange={(event) =>
            set("plannerMode", event.target.value as Settings["plannerMode"])
          }
        >
          <option value="deterministic">deterministic</option>
          <option value="ai">ai</option>
        </Select>
      </Field>

    </div>
  );
}
