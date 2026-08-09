import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { db } from "./index";
import { runMigrations } from "./migrate";
import { insertRecipeIfAbsent } from "./recipes";
import { SEED_PANTRY_STAPLES, SEED_RECIPES } from "./seed-data";
import { pantryStaples, profile, settings } from "./schema";
import {
  DEFAULT_PROFILE,
  DEFAULT_SETTINGS,
  type LocalSeed,
  localSeedSchema,
} from "~/lib/schemas";

/**
 * Seeding, and the local-values escape hatch.
 *
 * Committed code ships neutral defaults and `setupComplete: false`, which is
 * what makes the first-run wizard appear. If a gitignored `seed.local.json`
 * exists, its values are applied instead and setup is marked complete — so the
 * owner of the repo skips the wizard without a single personal number ever
 * reaching a commit.
 */

export const LOCAL_SEED_FILENAME = "seed.local.json";

export interface SeedResult {
  usedLocalSeed: boolean;
  recipesCreated: number;
  pantryCreated: number;
}

/** Reads and validates `seed.local.json`, or returns null if it is absent. */
export function readLocalSeed(cwd = process.cwd()): LocalSeed | null {
  const path = resolve(cwd, LOCAL_SEED_FILENAME);
  if (!existsSync(path)) return null;

  try {
    return localSeedSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  } catch (error) {
    // A malformed local seed should be loud but must not stop the app from
    // booting — the wizard is a complete fallback path.
    console.error(
      `[seed] ${LOCAL_SEED_FILENAME} is present but invalid; falling back to the setup wizard.`,
      error,
    );
    return null;
  }
}

/**
 * Idempotent. Safe to run on every boot: singletons are only created if
 * missing, and recipes and staples are matched by unique name.
 */
export function seedDatabase(cwd = process.cwd()): SeedResult {
  const localSeed = readLocalSeed(cwd);

  const hasProfile = db.query.profile.findFirst().sync();
  if (!hasProfile) {
    const p = localSeed ?? DEFAULT_PROFILE;
    db.insert(profile)
      .values({
        id: 1,
        weightKg: p.weightKg,
        heightCm: p.heightCm,
        age: p.age,
        sex: p.sex,
        activityFactor: p.activityFactor,
        deficitKcal: p.deficitKcal,
        proteinPerKg: p.proteinPerKg,
        fatPerKg: p.fatPerKg,
        trainingDays: p.trainingDays,
        cookDays: p.cookDays,
        assemblyDays: p.assemblyDays,
      })
      .run();
  }

  const hasSettings = db.query.settings.findFirst().sync();
  if (!hasSettings) {
    const s = localSeed ?? DEFAULT_SETTINGS;
    db.insert(settings)
      .values({
        id: 1,
        shoppingDay: s.shoppingDay,
        generationDay: s.generationDay,
        generationTime: s.generationTime,
        timezone: s.timezone,
        aiNovelRecipesPerWeek: s.aiNovelRecipesPerWeek,
        repeatWindowWeeks: s.repeatWindowWeeks,
        plannerMode: s.plannerMode,
        groceryCopyFormat: s.groceryCopyFormat,
        units: s.units,
        cuisines: s.cuisines,
        meals: s.meals,
        plannedMeals: s.plannedMeals,
        mainMeal: s.mainMeal,
        // A local seed means the owner has already supplied real values, so
        // there is nothing left for the wizard to ask.
        setupComplete: localSeed !== null,
      })
      .run();
  }

  let recipesCreated = 0;
  for (const body of SEED_RECIPES) {
    const { created } = insertRecipeIfAbsent(body, { source: "seed" });
    if (created) recipesCreated += 1;
  }

  const existingStaples = new Set(
    db.query.pantryStaples
      .findMany()
      .sync()
      .map((s) => s.name),
  );
  const newStaples = SEED_PANTRY_STAPLES.filter((n) => !existingStaples.has(n));
  if (newStaples.length > 0) {
    db.insert(pantryStaples)
      .values(newStaples.map((name) => ({ name, onHand: false })))
      .run();
  }

  return {
    usedLocalSeed: localSeed !== null,
    recipesCreated,
    pantryCreated: newStaples.length,
  };
}

// Allow `npm run db:seed` to drive this directly.
if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations();
  const result = seedDatabase();
  console.log(
    `Seeded ${result.recipesCreated} recipe(s) and ${result.pantryCreated} pantry staple(s).`,
  );
  console.log(
    result.usedLocalSeed
      ? `Applied values from ${LOCAL_SEED_FILENAME}; the setup wizard is skipped.`
      : `No ${LOCAL_SEED_FILENAME} found; the app will open the first-run setup wizard.`,
  );
}
