import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type EvalReport } from "./runner";

/**
 * Converts an eval report into Prometheus exposition format.
 *
 * This is what gives the eval pass-rate panel a *trend* rather than a single
 * latest number: the nightly workflow writes this file, a static file server in
 * the compose stack serves it, and Prometheus scrapes it like any other target.
 *
 * A pushgateway would be the textbook answer. This is a dozen lines and one
 * busybox container, for a metric that changes once a night.
 */

function escapeLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

export function reportToPrometheus(report: EvalReport): string {
  const lines: string[] = [];
  const labels = (pairs: Record<string, string>) =>
    Object.entries(pairs)
      .map(([k, v]) => `${k}="${escapeLabel(v)}"`)
      .join(",");

  const common = {
    model: report.model,
    prompt_hash: report.promptHashes.recipeGenerator,
  };

  lines.push(
    "# HELP eval_assertion_pass_rate Pass rate per Tier 1 assertion, 0-1.",
    "# TYPE eval_assertion_pass_rate gauge",
  );
  for (const assertion of report.assertions) {
    lines.push(
      `eval_assertion_pass_rate{${labels({ ...common, assertion: assertion.id, gate: assertion.gate })}} ${assertion.passRate}`,
    );
  }

  lines.push(
    "# HELP eval_assertion_threshold Configured gate threshold per assertion.",
    "# TYPE eval_assertion_threshold gauge",
  );
  for (const assertion of report.assertions) {
    lines.push(
      `eval_assertion_threshold{${labels({ assertion: assertion.id })}} ${assertion.threshold}`,
    );
  }

  lines.push(
    "# HELP eval_run_passed 1 when every hard gate was met.",
    "# TYPE eval_run_passed gauge",
    `eval_run_passed{${labels(common)}} ${report.passed ? 1 : 0}`,
    "# HELP eval_run_cost_usd Total spend for the run.",
    "# TYPE eval_run_cost_usd gauge",
    `eval_run_cost_usd{${labels(common)}} ${report.totalCostUsd.toFixed(6)}`,
    "# HELP eval_run_generations Total generations in the run.",
    "# TYPE eval_run_generations gauge",
    `eval_run_generations{${labels(common)}} ${report.totalRuns}`,
    "# HELP eval_redteam_hard_gate_failures Red-team runs that broke a hard gate.",
    "# TYPE eval_redteam_hard_gate_failures gauge",
    `eval_redteam_hard_gate_failures{${labels(common)}} ${report.redTeam.hardGateFailures}`,
    "# HELP eval_tier2_mean_score Model-graded mean score, 1-5. Report only.",
    "# TYPE eval_tier2_mean_score gauge",
  );

  if (report.tier2.meanStepCoherence !== null) {
    lines.push(
      `eval_tier2_mean_score{${labels({ ...common, dimension: "step_coherence", judge: report.judgeModel })}} ${report.tier2.meanStepCoherence}`,
    );
  }
  if (report.tier2.meanSeasoningBoldness !== null) {
    lines.push(
      `eval_tier2_mean_score{${labels({ ...common, dimension: "seasoning_boldness", judge: report.judgeModel })}} ${report.tier2.meanSeasoningBoldness}`,
    );
  }

  return `${lines.join("\n")}\n`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const input = process.argv[2] ?? join("evals", "reports", "eval-report.json");
  const output = process.argv[3] ?? join("observability", "eval-metrics", "eval-metrics.prom");

  const report = JSON.parse(readFileSync(input, "utf8")) as EvalReport;
  writeFileSync(output, reportToPrometheus(report), "utf8");
  console.log(`Wrote ${output}`);
}
