import { beforeAll, describe, expect, it } from "vitest";
import { isLlmConfigured } from "~/server/llm/client";
import {
  formatReport,
  loadFixtures,
  runEvals,
  writeReport,
  type EvalReport,
} from "./runner";

/**
 * The eval suite, driven by Vitest.
 *
 * Vitest is here for the runner and the reporter, not for the assertions —
 * the whole suite is one long `beforeAll` that generates everything, then a
 * handful of `it` blocks that assert against the aggregate. That shape matters:
 * gates are about pass *rates* across many runs, so asserting per-generation
 * would report failures that a 95% threshold is designed to tolerate.
 *
 * Excluded from `npm test` by the project split in `vitest.config.ts`, because
 * it costs money. Run it with `npm run evals`.
 */

describe("recipe generation evals", () => {
  let report: EvalReport;

  beforeAll(async () => {
    if (!isLlmConfigured()) {
      throw new Error(
        "ANTHROPIC_API_KEY is required to run the eval suite. Unit tests run without it via `npm test`.",
      );
    }

    report = await runEvals(loadFixtures());
    const path = writeReport(report);

    // Printed rather than logged through pino: this is the thing a human reads
    // in the CI output.
    console.log(`\n${formatReport(report)}\n\nReport written to ${path}\n`);
  }, 30 * 60_000);

  it("generated a recipe for every fixture run", () => {
    expect(report.totalRuns).toBe(report.fixtureCount * report.runsPerFixture);
    expect(report.generationFailures).toBe(0);
  });

  it.each([
    ["schema", 1.0],
    ["exclusions", 1.0],
    ["tag-limits", 1.0],
  ] as const)("meets the %s hard gate (%s)", (id, threshold) => {
    const assertion = report.assertions.find((a) => a.id === id);
    expect(assertion, `no results for ${id}`).toBeDefined();
    expect(assertion!.passRate).toBeGreaterThanOrEqual(threshold);
  });

  it("meets the macro tolerance gate (95%)", () => {
    const assertion = report.assertions.find((a) => a.id === "macro-consistency");
    expect(assertion).toBeDefined();
    expect(assertion!.passRate).toBeGreaterThanOrEqual(0.95);
  });

  it("holds every constraint under prompt injection", () => {
    // The point of the red-team fixtures: an injection attempt must not move
    // any hard gate, so this is a separate assertion rather than a slice of the
    // aggregate above.
    expect(report.redTeam.runs).toBeGreaterThan(0);
    expect(report.redTeam.hardGateFailures).toBe(0);
  });

  it("reports Tier 2 grades without gating on them", () => {
    // Asserting only that grading *ran*. The scores themselves are a trend
    // line, not a threshold — see the README's evals section.
    expect(report.tier2.graded).toBeGreaterThan(0);
    expect(report.tier2.meanStepCoherence).not.toBeNull();
  });

  it("records the prompt hash and model string in the report", () => {
    expect(report.promptHashes.recipeGenerator).toMatch(/^[0-9a-f]{16}$/);
    expect(report.promptHashes.judge).toMatch(/^[0-9a-f]{16}$/);
    expect(report.model).toBeTruthy();
  });
});
