#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Regenerates the supervision estimate in `docs/honesty-notes.md`.
 *
 * The estimate is a claim about how much human attention this project took, and
 * a claim like that rots the moment it stops being updated — it would sit there
 * describing a smaller project than the one a reader is looking at. So it is
 * generated from `docs/supervision-log.json` and rewritten by the pre-commit
 * hook rather than being prose someone has to remember to revise.
 *
 * What it is not: a measurement. The inputs are hand-counted round trips and a
 * deliberately wide minutes-per-exchange band. The generated text says so,
 * because a number this soft presented as precise would be worse than no number.
 */

const ROOT = process.cwd();
const LOG = join(ROOT, "docs", "supervision-log.json");
const DOC = join(ROOT, "docs", "honesty-notes.md");

const START = "<!-- supervision:start -->";
const END = "<!-- supervision:end -->";

/** Rounds to a whole hour, but never down to zero for real work. */
const hours = (minutes) => Math.max(1, Math.round(minutes / 60));

function main() {
  const log = JSON.parse(readFileSync(LOG, "utf8"));
  const { low: perLow, high: perHigh } = log.minutesPerExchange;

  const totals = log.sessions.reduce(
    (acc, s) => ({
      exchanges: acc.exchanges + s.exchanges,
      low: acc.low + s.exchanges * perLow + (s.fixedMinutes?.low ?? 0),
      high: acc.high + s.exchanges * perHigh + (s.fixedMinutes?.high ?? 0),
    }),
    { exchanges: 0, low: 0, high: 0 },
  );

  const body = [
    START,
    "",
    `**Estimate: roughly ${hours(totals.low)} to ${hours(totals.high)} hours of active, engaged time**`,
    `across ${log.sessions.length} working session${log.sessions.length === 1 ? "" : "s"} —`,
    "writing the specification, making decisions, and reviewing output. Not writing",
    "implementation code; almost none of that was typed by hand.",
    "",
    "The estimate is derived, not measured. It comes from",
    "[`supervision-log.json`](supervision-log.json), which records the round trips",
    `per session — ${totals.exchanges} so far — against a deliberately wide band of`,
    `${perLow}–${perHigh} minutes each: reading a long response, checking a diff or a`,
    "screenshot, deciding, replying. Sessions so far:",
    "",
    ...log.sessions.map((s) => `- **${s.date}** — ${s.exchanges} exchanges. ${s.note}`),
    "",
    "Treat the range as an order of magnitude. It excludes wall-clock time spent",
    "waiting on builds, test runs and model calls, which is not engaged time, and it",
    "almost certainly undercounts the minutes lost to re-reading something confusing.",
    "",
    "This block is rewritten by `scripts/update-supervision.mjs` on every commit, so",
    "the figure describes the repository as it currently stands rather than as it was",
    "the day someone last remembered to edit it.",
    "",
    END,
  ].join("\n");

  const doc = readFileSync(DOC, "utf8");
  const from = doc.indexOf(START);
  const to = doc.indexOf(END);

  if (from === -1 || to === -1) {
    // Loud, but not fatal: a missing marker should not block a commit.
    console.error(
      `[supervision] markers not found in ${DOC}; estimate not updated. ` +
        `Add ${START} / ${END} around the generated block.`,
    );
    process.exit(0);
  }

  const next = doc.slice(0, from) + body + doc.slice(to + END.length);
  if (next === doc) return;

  writeFileSync(DOC, next);
  console.log(
    `[supervision] estimate updated: ${hours(totals.low)}-${hours(totals.high)} hours across ${totals.exchanges} exchanges`,
  );
}

main();
