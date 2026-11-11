import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { recipeBodySchema, type RecipeBody } from "~/lib/schemas";
import type * as Client from "~/server/llm/client";
import type * as Generator from "~/server/llm/generator";
import { createHarness, TEST_ACCOUNT_ID, type Harness } from "../helpers/harness";

/**
 * Each generation request embeds its retrieval query exactly once.
 *
 * Every call site runs two lookups against the same text — favourite exemplars
 * and passages from the notes file — and shares one vector between them. Break
 * that sharing and nothing visible changes: the retrieved rows are identical,
 * every other test stays green, and only latency and CPU move. So the count is
 * asserted here directly, by replacing the transformers pipeline with one that
 * records what it was asked to embed.
 *
 * The pipeline is the thing counted, not `embed()`: a second model run is the
 * cost being guarded, whichever function it is reached through.
 */

const model = vi.hoisted(() => ({ texts: [] as string[] }));
const generateRecipe = vi.hoisted(() => vi.fn());

vi.mock("@huggingface/transformers", () => ({
  pipeline: async () => async (text: string) => {
    model.texts.push(text);
    // 384 is MiniLM's width and the vec0 tables' declared dimension; sqlite-vec
    // rejects any other length, so a mismatch fails loudly rather than quietly.
    return { data: new Float32Array(384).fill(1 / Math.sqrt(384)) };
  },
}));

// Only the two functions that would reach the network are replaced. `getClient`
// keeps its real guard, so anything that slipped past the generator stub would
// throw on the missing key instead of making a call.
vi.mock("~/server/llm/client", async (importOriginal) => ({
  ...(await importOriginal<typeof Client>()),
  isLlmConfigured: () => true,
}));
vi.mock("~/server/llm/generator", async (importOriginal) => ({
  ...(await importOriginal<typeof Generator>()),
  generateRecipe,
}));

let h: Harness;
let template: RecipeBody;

beforeAll(async () => {
  h = await createHarness();

  // The SSE route reads the session itself rather than taking one from a
  // caller, so `auth()` has to really answer. Registered here, after the
  // harness has loaded, because the harness registers a stub of its own for
  // this module and the later registration is the one that applies.
  vi.doMock("~/server/auth", () => ({
    auth: async () => ({ user: { id: TEST_ACCOUNT_ID, name: "Harness" }, expires: "" }),
    signIn: async () => undefined,
    signOut: async () => undefined,
    handlers: {},
  }));
});

beforeEach(async () => {
  h.reset();

  // Favourites must exist: with none, `similarFavorites` returns before it
  // searches, and half of what this file guards would never run.
  const seeded = h.db.listRecipes();
  h.db.setFavorite(seeded[0]!.id, true);
  template = recipeBodySchema.parse(seeded[0]);

  // A distinct name per call, because recipe names are unique in the library.
  let generated = 0;
  generateRecipe.mockReset();
  generateRecipe.mockImplementation(async () => ({
    recipe: { ...template, name: `Generated dish ${(generated += 1)}` },
    promptHash: "test-hash",
    modelString: "test-model",
    costUsd: 0,
    attempts: 1,
  }));

  // Last, so that nothing the setup embedded is counted against a test.
  model.texts.length = 0;
});

afterAll(() => h.cleanup());

/** How many times the model ran over exactly this text. */
const runsOver = (text: string) => model.texts.filter((t) => t === text).length;

describe("embedding the retrieval query", () => {
  it("can actually retrieve in this environment", async () => {
    // Without sqlite-vec the query is never embedded at all, and every count
    // below would be a comfortable zero-or-one whatever the code did.
    const { vectorSearchAvailable } = await import("~/server/db/index");
    expect(vectorSearchAvailable()).toBe(true);
  });

  it("runs the model once per request on the tRPC mutation", async () => {
    await h.caller.generation.generate({
      mealType: "cook",
      cuisine: "Thai",
      note: "use up the spinach",
    });

    expect(generateRecipe).toHaveBeenCalledTimes(1);
    expect(runsOver("Thai cook use up the spinach")).toBe(1);
  });

  it("runs the model once per request on the SSE route", async () => {
    const { POST } = await import("~/app/api/generate/stream/route");

    const response = await POST(
      new Request("http://localhost/api/generate/stream", {
        method: "POST",
        body: JSON.stringify({ mealType: "quick", cuisine: "Nordic", note: "no oven" }),
      }),
    );
    // Reading the body to its end is what waits for the generation to finish.
    const frames = await response.text();

    expect(response.status).toBe(200);
    expect(frames).toContain("event: done");
    expect(generateRecipe).toHaveBeenCalledTimes(1);
    expect(runsOver("Nordic quick no oven")).toBe(1);
  });

  it("runs the model once per slot in the scheduled run", async () => {
    // The seeded profile cooks on no day at all, and the run only generates
    // into cook slots — so without these it would generate nothing and the
    // assertion below would compare two empty lists.
    h.state.updateProfile({ ...h.state.getProfile(), cookDays: ["Tuesday", "Thursday"] });
    h.state.updateSettings({ ...h.state.getSettings(), aiNovelRecipesPerWeek: 2 });
    const { runWeeklyGeneration } = await import("~/server/scheduler/run");

    await runWeeklyGeneration({ weekStart: "2026-03-01", force: true, trigger: "manual" });

    // The run embeds nothing but its per-slot queries, so the model's whole
    // history should be one entry per generated recipe, in order.
    const requests = generateRecipe.mock.calls.map(
      ([request]) => request as { cuisine: string },
    );
    expect(requests).toHaveLength(2);
    expect(model.texts).toEqual(requests.map((r) => `${r.cuisine} cook`));
  });
});
