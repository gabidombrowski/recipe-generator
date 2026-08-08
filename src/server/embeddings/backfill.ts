import { listRecipes } from "~/server/db/queries";
import { runMigrations } from "~/server/db/migrate";
import { vectorSearchAvailable } from "~/server/db/index";
import { embeddingsAvailable, upsertRecipeEmbedding } from "./index";

/**
 * Embeds every recipe that needs it.
 *
 * Incremental by content hash, so re-running is cheap. Invoked by
 * `npm run embeddings:backfill` and by the library page the first time a
 * semantic search is attempted.
 */
export async function backfillEmbeddings(): Promise<{
  available: boolean;
  embedded: number;
  total: number;
}> {
  const recipes = listRecipes();

  if (!(await embeddingsAvailable())) {
    return { available: false, embedded: 0, total: recipes.length };
  }

  let embedded = 0;
  for (const recipe of recipes) {
    if (await upsertRecipeEmbedding(recipe)) embedded += 1;
  }

  return { available: true, embedded, total: recipes.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations();
  const result = await backfillEmbeddings();
  if (!result.available) {
    console.error(
      vectorSearchAvailable()
        ? "Embedding model could not be loaded; nothing was embedded."
        : "sqlite-vec is not loaded; nothing was embedded.",
    );
    process.exit(1);
  }
  console.log(`Embedded ${result.embedded} of ${result.total} recipe(s).`);
}
