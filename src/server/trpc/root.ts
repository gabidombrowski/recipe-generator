import { createCallerFactory, router } from "./init";
import { contextRouter } from "./routers/context";
import { generationRouter } from "./routers/generation";
import { groceryRouter } from "./routers/grocery";
import { kitchenRouter } from "./routers/kitchen";
import { planRouter } from "./routers/plan";
import { recipesRouter } from "./routers/recipes";
import { setupRouter } from "./routers/setup";

/**
 * The API surface. Every procedure under here is `protectedProcedure`, so the
 * whole router is closed by default.
 */
export const appRouter = router({
  setup: setupRouter,
  recipes: recipesRouter,
  plan: planRouter,
  grocery: groceryRouter,
  kitchen: kitchenRouter,
  generation: generationRouter,
  context: contextRouter,
});

export type AppRouter = typeof appRouter;

/** Server-side calling, used by the Playwright fixtures and by server components. */
export const createCaller = createCallerFactory(appRouter);
