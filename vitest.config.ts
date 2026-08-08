import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Two projects, deliberately separated:
 *
 *   unit  — fast, hermetic, no network. Runs on every PR.
 *   evals — hits the Anthropic API. Costs money, runs only on the eval
 *           workflow's path filter and the nightly schedule.
 *
 * `npm test` runs unit only; `npm run evals` runs evals only. Nothing runs
 * both by accident.
 */
export default defineConfig({
  resolve: {
    alias: {
      "~": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    projects: [
      {
        resolve: {
          alias: { "~": fileURLToPath(new URL("./src", import.meta.url)) },
        },
        test: {
          name: "unit",
          environment: "node",
          include: [
            "src/**/*.test.ts",
            "tests/unit/**/*.test.ts",
            // The eval *assertions* are pure and hermetic, so they belong in the
            // fast suite. `*.eval.test.ts` — which spends money — does not.
            "evals/assertions.test.ts",
          ],
        },
      },
      {
        resolve: {
          alias: { "~": fileURLToPath(new URL("./src", import.meta.url)) },
        },
        test: {
          name: "evals",
          environment: "node",
          include: ["evals/**/*.eval.test.ts"],
          // Each fixture runs 3 generations against the API; the suite is
          // network-bound, not CPU-bound.
          testTimeout: 180_000,
          hookTimeout: 60_000,
          maxConcurrency: 4,
        },
      },
    ],
  },
});
