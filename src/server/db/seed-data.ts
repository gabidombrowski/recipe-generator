import {
  applyIngredientTags,
  type Ingredient,
  type RecipeBody,
  recipeBodySchema,
} from "~/lib/schemas";

/**
 * The starting recipe library and pantry.
 *
 * This is food, not personal data, so it ships in the public repo. Profile,
 * Settings and dietary guidelines do not — those come from the first-run
 * wizard, the Kitchen page, or a gitignored `seed.local.json`.
 *
 * Ingredient tags here are neutral culinary facts (`fermented`, `aged`) applied
 * by `applyIngredientTags`. What to do about them is a runtime user decision.
 */

/** The refrigerate-promptly step every cook recipe must end with. */
export const REFRIGERATE_STEP =
  "Refrigerate the second portion promptly; eat within 1 day";

type RawRecipe = Omit<RecipeBody, "ingredients"> & {
  ingredients: Array<Omit<Ingredient, "tags"> & { tags?: string[] }>;
};

const RAW_RECIPES: RawRecipe[] = [
  // -------------------------------------------------------------------------
  // Cook: 15-30 minutes, always 2 servings, second portion refrigerated.
  // -------------------------------------------------------------------------
  {
    name: "Gochujang Beef Bowl",
    cuisine: "Korean",
    cookMinutes: 15,
    servings: 2,
    mealType: "cook",
    macrosPerServing: { kcal: 560, proteinG: 45, carbsG: 55, fatG: 18 },
    ingredients: [
      { name: "lean ground beef 93/7", qty: 12, unit: "oz" },
      { name: "gochujang", qty: 2, unit: "tbsp", tags: ["fermented"] },
      { name: "coconut aminos", qty: 4, unit: "tsp" },
      { name: "honey", qty: 2, unit: "tsp" },
      { name: "sesame oil", qty: 2, unit: "tsp" },
      { name: "garlic", qty: 4, unit: "clove" },
      { name: "cooked rice", qty: 2, unit: "cup" },
      { name: "cucumber", qty: 1, unit: "each" },
      { name: "scallion", qty: 2, unit: "each" },
    ],
    steps: [
      "Brown beef with garlic",
      "Stir in gochujang, coconut aminos, honey, sesame oil",
      "Serve one portion over rice with cucumber and scallions",
      REFRIGERATE_STEP,
    ],
  },
  {
    name: "Chicken with Brazilian Vinagrete",
    cuisine: "Brazilian",
    cookMinutes: 20,
    servings: 2,
    mealType: "cook",
    macrosPerServing: { kcal: 500, proteinG: 42, carbsG: 45, fatG: 16 },
    ingredients: [
      { name: "chicken thighs", qty: 12, unit: "oz" },
      { name: "smoked paprika", qty: 2, unit: "tsp" },
      { name: "tomato", qty: 2, unit: "each" },
      { name: "onion", qty: 0.5, unit: "each" },
      { name: "bell pepper", qty: 1, unit: "each" },
      { name: "parsley", qty: 4, unit: "tbsp" },
      { name: "olive oil", qty: 4, unit: "tsp" },
      { name: "lime", qty: 1, unit: "each" },
      { name: "cooked rice", qty: 1.5, unit: "cup" },
      { name: "kale", qty: 4, unit: "cup" },
    ],
    steps: [
      "Season and sear chicken",
      "Dice tomato, onion, pepper; toss with parsley, oil, lime juice, salt",
      "Saute kale with garlic; plate with rice",
      REFRIGERATE_STEP,
    ],
  },
  {
    name: "Pad Krapow Gai",
    cuisine: "Thai",
    cookMinutes: 15,
    servings: 2,
    mealType: "cook",
    macrosPerServing: { kcal: 510, proteinG: 44, carbsG: 50, fatG: 14 },
    ingredients: [
      { name: "ground chicken", qty: 12, unit: "oz" },
      { name: "garlic", qty: 6, unit: "clove" },
      { name: "thai chili", qty: 4, unit: "each" },
      { name: "oyster sauce", qty: 2, unit: "tbsp", tags: ["fermented"] },
      { name: "coconut aminos", qty: 4, unit: "tsp" },
      { name: "sugar", qty: 1, unit: "tsp" },
      { name: "basil", qty: 2, unit: "cup" },
      { name: "cooked rice", qty: 2, unit: "cup" },
    ],
    steps: [
      "Stir-fry garlic and chilies, add chicken",
      "Add oyster sauce, coconut aminos, sugar",
      "Off heat stir in basil; serve one portion over rice",
      REFRIGERATE_STEP,
    ],
  },
  {
    name: "Chipotle Chicken Tacos",
    cuisine: "Mexican",
    cookMinutes: 20,
    servings: 2,
    mealType: "cook",
    macrosPerServing: { kcal: 470, proteinG: 48, carbsG: 42, fatG: 12 },
    ingredients: [
      { name: "chicken breast", qty: 12, unit: "oz" },
      { name: "chipotle in adobo", qty: 2, unit: "tbsp" },
      { name: "cumin", qty: 2, unit: "tsp" },
      { name: "oregano", qty: 1, unit: "tsp" },
      { name: "lime", qty: 2, unit: "each" },
      { name: "corn tortillas", qty: 6, unit: "each" },
      { name: "red onion", qty: 1, unit: "each" },
      { name: "greek yogurt", qty: 6, unit: "tbsp" },
    ],
    steps: [
      "Quick-pickle onion in lime juice and salt",
      "Sear chipotle-spiced chicken",
      "Assemble tacos with yogurt-lime crema",
      "Refrigerate the second portion of chicken promptly; eat within 1 day (tortillas fresh each day)",
    ],
  },
  {
    name: "Lemon Garlic Shrimp with White Beans",
    cuisine: "Mediterranean",
    cookMinutes: 15,
    servings: 2,
    mealType: "cook",
    macrosPerServing: { kcal: 480, proteinG: 46, carbsG: 38, fatG: 15 },
    ingredients: [
      { name: "fresh or flash-frozen shrimp", qty: 12, unit: "oz" },
      { name: "olive oil", qty: 4, unit: "tsp" },
      { name: "garlic", qty: 8, unit: "clove" },
      { name: "chili flakes", qty: 1, unit: "tsp" },
      { name: "cannellini beans", qty: 2, unit: "can" },
      { name: "spinach", qty: 4, unit: "cup" },
      { name: "lemon", qty: 2, unit: "each" },
      { name: "goat cheese", qty: 2, unit: "oz" },
    ],
    steps: [
      "Saute shrimp with garlic and chili flakes",
      "Add beans and spinach until wilted",
      "Finish with lemon and goat cheese",
      REFRIGERATE_STEP,
    ],
  },
  {
    name: "Salmon Ginger Rice Bowl",
    cuisine: "Japanese",
    cookMinutes: 15,
    servings: 2,
    mealType: "cook",
    macrosPerServing: { kcal: 540, proteinG: 40, carbsG: 52, fatG: 18 },
    ingredients: [
      { name: "fresh salmon", qty: 10, unit: "oz" },
      { name: "coconut aminos", qty: 2, unit: "tbsp" },
      { name: "honey", qty: 2, unit: "tsp" },
      { name: "ginger", qty: 2, unit: "tsp" },
      { name: "cooked rice", qty: 2, unit: "cup" },
      { name: "edamame", qty: 1, unit: "cup" },
      { name: "cucumber", qty: 1, unit: "each" },
    ],
    steps: [
      "Pan-sear salmon",
      "Glaze with coconut aminos, honey, ginger",
      "Serve over rice with edamame and cucumber",
      REFRIGERATE_STEP,
    ],
  },

  // -------------------------------------------------------------------------
  // Quick: 5-10 minutes, single serving.
  // -------------------------------------------------------------------------
  {
    name: "Green Curry Egg Scramble",
    cuisine: "Thai",
    cookMinutes: 8,
    servings: 1,
    mealType: "quick",
    macrosPerServing: { kcal: 430, proteinG: 36, carbsG: 30, fatG: 18 },
    ingredients: [
      { name: "eggs", qty: 3, unit: "each" },
      { name: "egg whites", qty: 0.5, unit: "cup" },
      { name: "green curry paste", qty: 2, unit: "tsp" },
      { name: "coconut milk", qty: 2, unit: "tbsp" },
      { name: "spinach", qty: 1, unit: "cup" },
      { name: "microwave rice pouch", qty: 0.5, unit: "pouch" },
    ],
    steps: [
      "Whisk eggs with curry paste and coconut milk",
      "Soft-scramble with spinach",
      "Serve over microwaved rice",
    ],
  },
  {
    name: "Harissa Chickpea Skillet",
    cuisine: "North African",
    cookMinutes: 10,
    servings: 1,
    mealType: "quick",
    macrosPerServing: { kcal: 450, proteinG: 32, carbsG: 48, fatG: 14 },
    ingredients: [
      { name: "chickpeas", qty: 1, unit: "can" },
      { name: "harissa", qty: 1, unit: "tbsp" },
      { name: "olive oil", qty: 1, unit: "tsp" },
      { name: "eggs", qty: 2, unit: "each" },
      { name: "baby spinach", qty: 2, unit: "cup" },
      { name: "cumin", qty: 0.5, unit: "tsp" },
    ],
    steps: [
      "Saute chickpeas in harissa and cumin",
      "Wilt in spinach",
      "Crack eggs on top, cover 3 min",
    ],
  },

  // -------------------------------------------------------------------------
  // Assembly: no cooking, single serving.
  // -------------------------------------------------------------------------
  {
    name: "Rotisserie Chicken Sesame Bowl",
    // Shop-bought chicken, a rice pouch and bagged slaw belong to no country's
    // cooking. "Any" is the honest label, same as the shake below.
    cuisine: "Any",
    cookMinutes: 5,
    servings: 1,
    mealType: "assembly",
    macrosPerServing: { kcal: 520, proteinG: 48, carbsG: 50, fatG: 14 },
    ingredients: [
      { name: "rotisserie chicken breast", qty: 6, unit: "oz" },
      { name: "microwave rice pouch", qty: 1, unit: "pouch" },
      { name: "bagged slaw mix", qty: 2, unit: "cup" },
      { name: "sesame ginger dressing", qty: 2, unit: "tbsp" },
    ],
    steps: [
      "Microwave rice",
      "Toss slaw with dressing",
      "Top with pulled chicken",
    ],
  },
  {
    name: "Pea Protein Power Shake",
    cuisine: "Any",
    cookMinutes: 3,
    servings: 1,
    mealType: "assembly",
    macrosPerServing: { kcal: 380, proteinG: 42, carbsG: 40, fatG: 6 },
    ingredients: [
      { name: "pea protein powder", qty: 40, unit: "g" },
      { name: "banana", qty: 1, unit: "each" },
      { name: "frozen berries", qty: 0.75, unit: "cup" },
      { name: "oat milk", qty: 1, unit: "cup" },
    ],
    steps: ["Blend everything"],
  },
  {
    name: "Caprese White Bean Plate",
    cuisine: "Italian",
    cookMinutes: 5,
    servings: 1,
    mealType: "assembly",
    macrosPerServing: { kcal: 460, proteinG: 34, carbsG: 38, fatG: 18 },
    ingredients: [
      { name: "fresh mozzarella", qty: 3, unit: "oz" },
      { name: "cannellini beans", qty: 1, unit: "can" },
      { name: "tomato", qty: 1, unit: "each" },
      { name: "basil", qty: 0.5, unit: "cup" },
      { name: "olive oil", qty: 2, unit: "tsp" },
      { name: "balsamic glaze", qty: 1, unit: "tsp" },
    ],
    steps: [
      "Drain beans, slice tomato and mozzarella",
      "Layer with basil",
      "Dress with oil and balsamic",
    ],
  },
  {
    name: "Greek Yogurt Protein Bowl",
    cuisine: "Mediterranean",
    cookMinutes: 3,
    servings: 1,
    mealType: "assembly",
    macrosPerServing: { kcal: 400, proteinG: 38, carbsG: 45, fatG: 8 },
    ingredients: [
      { name: "greek yogurt 2%", qty: 1.5, unit: "cup" },
      { name: "honey", qty: 1, unit: "tbsp" },
      { name: "granola", qty: 0.33, unit: "cup" },
      { name: "berries", qty: 0.75, unit: "cup" },
      { name: "cinnamon", qty: 0.5, unit: "tsp" },
    ],
    steps: ["Layer yogurt, honey, granola, berries, cinnamon"],
  },
];

/** Validated seed recipes with culinary tags normalised. */
export const SEED_RECIPES: RecipeBody[] = RAW_RECIPES.map((raw) => {
  const parsed = recipeBodySchema.parse(raw);
  return { ...parsed, ingredients: applyIngredientTags(parsed.ingredients) };
});

/** Things assumed to be in the cupboard; the grocery list checks rather than buys. */
export const SEED_PANTRY_STAPLES = [
  "olive oil",
  "cumin",
  "chili flakes",
  "smoked paprika",
  "oregano",
  "cinnamon",
  "salt",
  "pepper",
  "honey",
  "creatine",
  "pea protein powder",
  "casein",
  "oat milk",
] as const;
