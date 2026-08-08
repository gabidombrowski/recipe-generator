import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "./index";
import { constraints, ingredientTags } from "./schema";
import {
  configFingerprint,
  constraintSchema,
  resolveConfig,
  type Constraint,
  type DietaryConfig,
  type IngredientTag,
  type StoredConstraint,
} from "~/lib/constraints";

/**
 * The dietary configuration store.
 *
 * One read path (`getDietaryConfig`) feeds the planner, the verifier, the
 * grocery builder and the prompt renderer, so all four cannot disagree about
 * what the rules are — the same reason the verifier reuses the planner's rule
 * functions rather than reimplementing them.
 *
 * Everything here starts empty. The committed repository has no rules.
 */

export function listConstraints(): StoredConstraint[] {
  return db
    .select()
    .from(constraints)
    .orderBy(constraints.id)
    .all()
    .flatMap((row) => {
      // A row that fails validation is skipped rather than crashing the app:
      // a rule written by an older schema version should degrade to "absent",
      // not take down the page that would let you fix it.
      const parsed = constraintSchema.safeParse(row.payload);
      if (!parsed.success) return [];
      return [
        {
          id: row.id,
          constraint: parsed.data,
          active: row.active,
          createdAt: row.createdAt,
        },
      ];
    });
}

export function getDietaryConfig(): DietaryConfig {
  return resolveConfig(listConstraints());
}

/** Short hash of the active config, recorded next to `promptHash`. */
export function configHash(config: DietaryConfig = getDietaryConfig()): string {
  return createHash("sha256").update(configFingerprint(config)).digest("hex").slice(0, 16);
}

export function addConstraint(constraint: Constraint): StoredConstraint[] {
  db.insert(constraints)
    .values({ kind: constraint.kind, payload: constraint, active: true })
    .run();
  return listConstraints();
}

export function addConstraints(list: readonly Constraint[]): StoredConstraint[] {
  for (const constraint of list) {
    db.insert(constraints)
      .values({ kind: constraint.kind, payload: constraint, active: true })
      .run();
  }
  return listConstraints();
}

export function setConstraintActive(id: number, active: boolean): StoredConstraint[] {
  db.update(constraints).set({ active }).where(eq(constraints.id, id)).run();
  return listConstraints();
}

export function removeConstraint(id: number): StoredConstraint[] {
  db.delete(constraints).where(eq(constraints.id, id)).run();
  return listConstraints();
}

// ---------------------------------------------------------------------------
// Tag vocabulary
// ---------------------------------------------------------------------------

export function listIngredientTags(): IngredientTag[] {
  return db
    .select()
    .from(ingredientTags)
    .orderBy(ingredientTags.name)
    .all()
    .map((row) => ({
      id: row.id,
      name: row.name,
      matchPatterns: row.matchPatterns,
    }));
}

export function addIngredientTag(name: string, matchPatterns: string[]): IngredientTag[] {
  db.insert(ingredientTags)
    .values({ name: name.trim().toLowerCase(), matchPatterns })
    .onConflictDoUpdate({
      target: ingredientTags.name,
      set: { matchPatterns },
    })
    .run();
  return listIngredientTags();
}

export function removeIngredientTag(id: number): IngredientTag[] {
  db.delete(ingredientTags).where(eq(ingredientTags.id, id)).run();
  return listIngredientTags();
}
