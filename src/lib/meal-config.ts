/**
 * Keeping the three meal settings consistent with each other.
 *
 * `meals`, `plannedMeals` and `mainMeal` are not independent: planned meals
 * must be a subset of meals, and the main meal must be one of the planned ones.
 * Nothing downstream re-checks that — the scheduler simply looks up
 * `mainMeal` and gets nothing back — so a dangling reference is silent.
 *
 * This lived inside the settings form, which meant the rule was only as good as
 * that one component and could not be tested without rendering React. It is
 * domain logic, so it belongs with the domain.
 */

export interface MealConfig {
  meals: string[];
  plannedMeals: string[];
  mainMeal: string;
}

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * Re-establishes the invariants after any change.
 *
 * Deliberately total: given any input, including nonsense, it returns a
 * consistent config rather than throwing. The caller is a form, and a form that
 * can put its own settings into an unsaveable state is worse than one that
 * quietly corrects.
 */
export function reconcile(config: MealConfig): MealConfig {
  const meals = config.meals.filter((m) => m.trim().length > 0);

  // Planned meals must exist. Order follows `meals` rather than the order they
  // were ticked, so the day always reads breakfast-to-dinner.
  const planned = meals.filter((m) =>
    config.plannedMeals.some((p) => sameName(p, m)),
  );

  // The main meal must be planned. Falling back to the first planned meal keeps
  // the cook cycle attached to something rather than silently to nothing.
  const main = planned.some((p) => sameName(p, config.mainMeal))
    ? config.mainMeal
    : (planned[0] ?? "");

  return { meals, plannedMeals: planned, mainMeal: main };
}

export function addMeal(config: MealConfig, name: string): MealConfig {
  const trimmed = name.trim();
  if (!trimmed) return config;
  // Case-insensitive: "dinner" under "Dinner" is the same meal, and a duplicate
  // would show twice in every picker and divide the day's targets by one too many.
  if (config.meals.some((m) => sameName(m, trimmed))) return config;
  return reconcile({ ...config, meals: [...config.meals, trimmed] });
}

/**
 * Removing the last meal is refused rather than reconciled.
 *
 * `reconcile` repairs a config; it cannot invent one. With nothing left there
 * is no planned meal to divide the day's targets across and nothing for the
 * cook cycle to attach to, so the result fails `mealNameListSchema` — and used
 * to do so at the wizard's final step, five screens after the mistake.
 */
export function removeMeal(config: MealConfig, name: string): MealConfig {
  const remaining = config.meals.filter((m) => !sameName(m, name));
  if (remaining.length === 0) return config;

  return reconcile({
    ...config,
    meals: config.meals.filter((m) => !sameName(m, name)),
  });
}

/** Unticking the last planned meal is refused, for the same reason. */
export function togglePlanned(config: MealConfig, name: string): MealConfig {
  const isPlanned = config.plannedMeals.some((m) => sameName(m, name));
  if (isPlanned && config.plannedMeals.length === 1) return config;

  return reconcile({
    ...config,
    plannedMeals: isPlanned
      ? config.plannedMeals.filter((m) => !sameName(m, name))
      : [...config.plannedMeals, name],
  });
}
