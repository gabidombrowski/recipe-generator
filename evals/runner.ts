import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  GATES,
  runTier1,
  type AssertionId,
  type AssertionResult,
  type Fixture,
} from "./assertions";
import { judgeRecipe, type Grade } from "./judge";
import { MODELS, TIMEOUTS } from "~/server/llm/client";
import { mapWithConcurrency } from "~/lib/concurrency";
import { buildSystemPrompt, generateRecipe } from "~/server/llm/generator";
import { loadPrompt, PROMPT_NAMES } from "~/server/llm/prompts";
import { DEFAULT_PROFILE, type RecipeBody } from "~/lib/schemas";
import {
  EMPTY_CONFIG,
  resolveConfig,
  type Constraint,
} from "~/lib/constraints";

/**
 * The eval runner.
 *
 * Hand-rolled on purpose. An eval framework would add a dependency, a config
 * format and an abstraction layer, in exchange for something that is a hundred
 * lines of loops and arithmetic — and the assertions are the interesting part,
 * not the plumbing.
 *
 * Each fixture runs several times because generation is non-deterministic: a
 * constraint that holds once may not hold three times, and it is the pass
 * *rate* that tells you whether the prompt works.
 */

export const RUNS_PER_FIXTURE = 3;

/**
 * How many generations may be in flight at once.
 *
 * Thirty fixtures times three runs is ninety generations, each followed by a
 * judge call. Sequentially that is roughly half an hour of wall clock against
 * a CI job capped at 45 minutes — the suite was sized to hit its own ceiling.
 * Five is chosen to stay well inside Anthropic's per-minute limits rather than
 * to go as fast as possible; `isRetryable` absorbs the occasional 429, but a
 * cap that provokes them constantly would make the suite flaky for a reason
 * that has nothing to do with the prompts it is measuring.
 *
 * Overridable so a tighter rate limit can be accommodated without a code change.
 */
export const EVAL_CONCURRENCY = Number(process.env.EVAL_CONCURRENCY ?? 5);

const FIXTURES_DIR = join(process.cwd(), "evals", "fixtures");
const REPORTS_DIR = join(process.cwd(), "evals", "reports");

/**
 * A fixed profile so eval results depend on the prompt and the model, not on
 * whatever is in the developer's database. It is also not personal data, which
 * matters for a public repo.
 */
export const EVAL_PROFILE = {
  ...DEFAULT_PROFILE,
  weightKg: 80,
  heightCm: 175,
  age: 35,
  activityFactor: 1.45,
  deficitKcal: 400,
  proteinPerKg: 2.0,
  fatPerKg: 0.8,
  trainingDays: ["Monday", "Wednesday", "Friday"] as const,
} as typeof DEFAULT_PROFILE;

/**
 * The constraint set a fixture is generated and graded against.
 *
 * Synthetic and shared, so the public repo carries a complete worked example
 * without carrying anyone's actual rules, and CI is hermetic. A fixture may
 * override any part of it.
 */
export const REFERENCE_CONSTRAINTS: Constraint[] = [
  { kind: "meal_macros", proteinMinG: 35, proteinMaxG: 45 },
  {
    kind: "meal_shape",
    mealType: "cook",
    minMinutes: 15,
    maxMinutes: 30,
    servings: 2,
    requiredFinalStepPhrases: ["refrigerate", "1 day"],
  },
  {
    kind: "meal_shape",
    mealType: "quick",
    minMinutes: 5,
    maxMinutes: 10,
    servings: 1,
    requiredFinalStepPhrases: [],
  },
  {
    kind: "meal_shape",
    mealType: "assembly",
    minMinutes: null,
    maxMinutes: 5,
    servings: 1,
    requiredFinalStepPhrases: [],
  },
  {
    kind: "ingredient_form",
    match: [
      "tuna",
      "salmon",
      "sardine",
      "anchovy",
      "crab",
      "clam",
      "mackerel",
      "shrimp",
      "prawn",
      "oyster",
    ],
    forbid: ["canned", "tinned", "jarred", "from a can"],
    exempt: ["sauce", "paste"],
  },
];

export function fixtureConfig(fixture: Fixture) {
  const extra: Constraint[] = (fixture.tagLimits ?? []).map((limit) => ({
    kind: "tag_cap" as const,
    tag: limit.tag,
    maxPerRecipe: limit.maxPerRecipe,
    maxPerWeek: null,
  }));

  return resolveConfig(
    [...REFERENCE_CONSTRAINTS, ...extra].map((constraint, index) => ({
      id: index + 1,
      constraint,
      active: true,
      createdAt: "2026-01-01",
    })),
  );
}

export function loadFixtures(): Fixture[] {
  return readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map(
      (file) =>
        JSON.parse(readFileSync(join(FIXTURES_DIR, file), "utf8")) as Fixture,
    );
}

export interface RunRecord {
  fixtureId: string;
  run: number;
  ok: boolean;
  error?: string;
  assertions: AssertionResult[];
  grade: Grade | null;
  gradeError?: string;
  recipeName?: string;
  costUsd: number;
  latencyMs: number;
  attempts: number;
}

export interface AssertionSummary {
  id: AssertionId;
  gate: "hard" | "soft";
  evaluated: number;
  passed: number;
  passRate: number;
  threshold: number;
  meetsGate: boolean;
  failures: Array<{ fixtureId: string; run: number; detail: string }>;
}

export interface EvalReport {
  startedAt: string;
  finishedAt: string;
  model: string;
  judgeModel: string;
  promptHashes: { recipeGenerator: string; judge: string };
  runsPerFixture: number;
  fixtureCount: number;
  totalRuns: number;
  generationFailures: number;
  totalCostUsd: number;
  assertions: AssertionSummary[];
  tier2: {
    graded: number;
    meanStepCoherence: number | null;
    meanSeasoningBoldness: number | null;
  };
  redTeam: { fixtures: number; runs: number; hardGateFailures: number };
  runs: RunRecord[];
  /** False when any hard gate is below threshold. */
  passed: boolean;
}

async function runOnce(fixture: Fixture, run: number): Promise<RunRecord> {
  try {
    const result = await generateRecipe(
      fixture.request,
      {
        profile: EVAL_PROFILE,
        trainingDay: true,
        excluded: fixture.excluded ?? [],
        // Fixtures carry their own constraint set, which is what makes the
        // Tier 1 gates test *the fixture's* rules rather than anyone's in
        // particular. See REFERENCE_CONSTRAINTS for the shared default.
        config: fixtureConfig(fixture),
        // No exemplars: the evals measure the prompt, not the library.
        exemplars: [],
      },
      // A hung call would otherwise hold a concurrency slot for the whole run.
      { timeoutMs: TIMEOUTS.evals },
    );

    const { recipe, results } = runTier1(result.recipe, fixture);
    const judged = recipe ? await judgeRecipe(recipe as RecipeBody) : null;

    return {
      fixtureId: fixture.id,
      run,
      ok: true,
      assertions: results,
      grade: judged?.grade ?? null,
      gradeError: judged?.error,
      recipeName: recipe?.name,
      costUsd: result.costUsd,
      latencyMs: result.latencyMs,
      attempts: result.attempts,
    };
  } catch (error) {
    // A generation that never produced a valid recipe fails the schema gate:
    // it is a real failure, not a skipped test.
    return {
      fixtureId: fixture.id,
      run,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      assertions: [
        {
          id: "schema",
          passed: false,
          detail: `generation failed: ${error instanceof Error ? error.message : String(error)}`,
          gate: "hard",
        },
      ],
      grade: null,
      costUsd: 0,
      latencyMs: 0,
      attempts: 0,
    };
  }
}

export async function runEvals(
  fixtures: Fixture[] = loadFixtures(),
): Promise<EvalReport> {
  const startedAt = new Date().toISOString();
  const runs: RunRecord[] = [];

  /**
   * Flattened first, so the cap applies across the whole matrix rather than
   * per fixture. Nesting the loops would serialise the three runs of each
   * fixture behind one another for no reason — they are independent samples.
   */
  const jobs = fixtures.flatMap((fixture) =>
    Array.from({ length: RUNS_PER_FIXTURE }, (_, i) => ({
      fixture,
      run: i + 1,
    })),
  );

  const settled = await mapWithConcurrency(jobs, EVAL_CONCURRENCY, (job) =>
    // `runOnce` already converts a failed generation into a failing schema
    // assertion, so a rejection here means the harness itself broke — a bug in
    // the runner, not a bad fixture. Caught rather than left to reject the
    // whole suite, and recorded so it is visible in the report instead of
    // vanishing into a stack trace.
    runOnce(job.fixture, job.run).then(
      (record) => ({ status: "fulfilled" as const, record }),
      (error: unknown) => ({ status: "rejected" as const, job, error }),
    ),
  );

  type Settled = (typeof settled)[number];
  const isRejected = (
    s: Settled,
  ): s is Extract<Settled, { status: "rejected" }> => s.status === "rejected";
  const isFulfilled = (
    s: Settled,
  ): s is Extract<Settled, { status: "fulfilled" }> => s.status === "fulfilled";

  const harnessFailures = settled.filter(isRejected);
  for (const failure of harnessFailures) {
    console.error(
      `[evals] harness error on ${failure.job.fixture.id} run ${failure.job.run}:`,
      failure.error,
    );
  }
  if (harnessFailures.length > 0) {
    // Loud on purpose. A partially-run suite that reports a pass rate over the
    // fixtures it happened to complete is worse than no number at all.
    throw new Error(
      `${harnessFailures.length} of ${jobs.length} eval runs failed inside the harness. ` +
        `See the errors above; the report was not written.`,
    );
  }

  runs.push(...settled.filter(isFulfilled).map((s) => s.record));

  const finishedAt = new Date().toISOString();

  // Aggregate per assertion.
  const ids = [...new Set(runs.flatMap((r) => r.assertions.map((a) => a.id)))];
  const assertions: AssertionSummary[] = ids.map((id) => {
    const relevant = runs.flatMap((run) =>
      run.assertions.filter((a) => a.id === id).map((a) => ({ run, a })),
    );
    const passed = relevant.filter((r) => r.a.passed).length;
    const passRate = relevant.length === 0 ? 1 : passed / relevant.length;
    const threshold = GATES[id] ?? 1;

    return {
      id,
      gate: relevant[0]?.a.gate ?? "soft",
      evaluated: relevant.length,
      passed,
      passRate,
      threshold,
      meetsGate: passRate >= threshold,
      failures: relevant
        .filter((r) => !r.a.passed)
        .map((r) => ({
          fixtureId: r.run.fixtureId,
          run: r.run.run,
          detail: r.a.detail,
        })),
    };
  });

  const grades = runs.map((r) => r.grade).filter((g): g is Grade => g !== null);
  const mean = (values: number[]) =>
    values.length === 0
      ? null
      : values.reduce((a, b) => a + b, 0) / values.length;

  const redTeamIds = new Set(
    fixtures.filter((f) => f.redTeam).map((f) => f.id),
  );
  const redTeamRuns = runs.filter((r) => redTeamIds.has(r.fixtureId));

  // Read the hashes from the prompt files directly rather than from a run, so
  // the report is complete even when every generation failed.
  const promptHashes = {
    recipeGenerator: buildSystemPrompt(
      { mealType: "cook" },
      {
        profile: EVAL_PROFILE,
        trainingDay: true,
        excluded: [],
        config: EMPTY_CONFIG,
        exemplars: [],
      },
    ).promptHash,
    judge: loadPrompt(PROMPT_NAMES.judge).hash,
  };

  const report: EvalReport = {
    startedAt,
    finishedAt,
    model: MODELS.generation,
    judgeModel: MODELS.judge,
    promptHashes,
    runsPerFixture: RUNS_PER_FIXTURE,
    fixtureCount: fixtures.length,
    totalRuns: runs.length,
    generationFailures: runs.filter((r) => !r.ok).length,
    totalCostUsd: runs.reduce((sum, r) => sum + r.costUsd, 0),
    assertions,
    tier2: {
      graded: grades.length,
      meanStepCoherence: mean(grades.map((g) => g.stepCoherence)),
      meanSeasoningBoldness: mean(grades.map((g) => g.seasoningBoldness)),
    },
    redTeam: {
      fixtures: redTeamIds.size,
      runs: redTeamRuns.length,
      hardGateFailures: redTeamRuns.filter((r) =>
        r.assertions.some((a) => a.gate === "hard" && !a.passed),
      ).length,
    },
    runs,
    passed: assertions
      .filter((a) => a.gate === "hard")
      .every((a) => a.meetsGate),
  };

  return report;
}

export function writeReport(report: EvalReport): string {
  mkdirSync(REPORTS_DIR, { recursive: true });
  const path = join(REPORTS_DIR, "eval-report.json");
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return path;
}

/** Human-readable summary for the CI log and the PR comment. */
export function formatReport(report: EvalReport): string {
  const lines: string[] = [
    `Model: ${report.model} · judge: ${report.judgeModel}`,
    `Prompt hashes: generator ${report.promptHashes.recipeGenerator}, judge ${report.promptHashes.judge}`,
    `${report.fixtureCount} fixtures x ${report.runsPerFixture} runs = ${report.totalRuns} generations`,
    `Cost: $${report.totalCostUsd.toFixed(4)}`,
    "",
    "Tier 1 (gating):",
  ];

  for (const a of report.assertions) {
    const pct = (a.passRate * 100).toFixed(1);
    const target = (a.threshold * 100).toFixed(0);
    const mark = a.meetsGate ? "PASS" : "FAIL";
    lines.push(
      `  ${mark}  ${a.id.padEnd(18)} ${pct}% (${a.passed}/${a.evaluated}), need ${target}%${a.gate === "hard" ? " [hard gate]" : ""}`,
    );
    for (const failure of a.failures.slice(0, 3)) {
      lines.push(
        `         - ${failure.fixtureId} run ${failure.run}: ${failure.detail}`,
      );
    }
    if (a.failures.length > 3) {
      lines.push(`         - ...and ${a.failures.length - 3} more`);
    }
  }

  lines.push(
    "",
    "Tier 2 (report only):",
    `  step coherence     ${report.tier2.meanStepCoherence?.toFixed(2) ?? "n/a"} / 5`,
    `  seasoning boldness ${report.tier2.meanSeasoningBoldness?.toFixed(2) ?? "n/a"} / 5`,
    "",
    `Red team: ${report.redTeam.runs} runs across ${report.redTeam.fixtures} fixtures, ${report.redTeam.hardGateFailures} hard-gate failure(s)`,
    "",
    report.passed ? "RESULT: pass" : "RESULT: fail",
  );

  return lines.join("\n");
}
