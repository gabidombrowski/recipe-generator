import { eq } from "drizzle-orm";
import { db } from "./index";
import { profile, settings } from "./schema";
import {
  DEFAULT_PROFILE,
  DEFAULT_SETTINGS,
  type Profile,
  type Settings,
} from "~/lib/schemas";

/**
 * Access to the two singleton rows.
 *
 * Both are created during seeding, so the getters should always find a row —
 * but they fall back to the neutral defaults rather than throwing, because a
 * missing profile should render the setup wizard, not a 500.
 */

const SINGLETON_ID = 1;

/**
 * Reads a singleton, tolerating a database that has not been migrated yet.
 *
 * A missing table means the app is starting for the very first time, or was
 * built before its volume was mounted. Falling back to the neutral defaults
 * renders the setup wizard, which is the correct thing to show — far better
 * than a 500 on the one screen that could fix the problem.
 */
function readSingleton<T>(read: () => T | undefined): T | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

export function getProfile(): Profile {
  const row = readSingleton(() => db.query.profile.findFirst().sync());
  if (!row) return DEFAULT_PROFILE;

  return {
    weightKg: row.weightKg,
    heightCm: row.heightCm,
    age: row.age,
    sex: row.sex,
    activityFactor: row.activityFactor,
    deficitKcal: row.deficitKcal,
    proteinPerKg: row.proteinPerKg,
    fatPerKg: row.fatPerKg,
    trainingDays: row.trainingDays,
    cookDays: row.cookDays,
    assemblyDays: row.assemblyDays,
  };
}

export interface SettingsWithSetup extends Settings {
  setupComplete: boolean;
}

export function getSettings(): SettingsWithSetup {
  const row = readSingleton(() => db.query.settings.findFirst().sync());
  if (!row) return { ...DEFAULT_SETTINGS, setupComplete: false };

  return {
    shoppingDay: row.shoppingDay,
    generationDay: row.generationDay,
    generationTime: row.generationTime,
    timezone: row.timezone,
    aiNovelRecipesPerWeek: row.aiNovelRecipesPerWeek,
    repeatWindowWeeks: row.repeatWindowWeeks,
    plannerMode: row.plannerMode,
    setupComplete: row.setupComplete,
  };
}

export function updateProfile(next: Profile): Profile {
  db.update(profile)
    .set({ ...next, updatedAt: new Date().toISOString() })
    .where(eq(profile.id, SINGLETON_ID))
    .run();
  return getProfile();
}

export function updateSettings(next: Settings): SettingsWithSetup {
  db.update(settings)
    .set({ ...next, updatedAt: new Date().toISOString() })
    .where(eq(settings.id, SINGLETON_ID))
    .run();
  return getSettings();
}

/** Marks first-run setup finished. Irreversible from the UI, by design. */
export function completeSetup(): void {
  db.update(settings)
    .set({ setupComplete: true })
    .where(eq(settings.id, SINGLETON_ID))
    .run();
}
