#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mintSession } from "./session.mjs";

/**
 * Records `demo/fixtures.json` — the demo's entire dataset.
 *
 * The one rule that matters: fixtures are synthetic **by construction**, not
 * by inspection. The script builds its own database in a temp directory from
 * the committed migrations and seed, walks the setup wizard with the
 * documented defaults, plans a week with the deterministic planner, and only
 * then snapshots the API. Nothing here ever reads an existing database — the
 * previous demo attempt leaked a real profile precisely because its data came
 * from a live environment, and "we checked it" is a weaker guarantee than
 * "it was never reachable".
 *
 *   node scripts/record-demo-fixtures.mjs
 */

const QUERIES = [
  "plan.today",
  "plan.week",
  "plan.nextOpenSlot",
  "grocery.list",
  "grocery.copyText",
  "generation.available",
  "generation.libraryCoverage",
  "generation.feedback",
  "setup.state",
  "recipes.list",
  "kitchen.constraints",
  "kitchen.excluded",
  "kitchen.leftovers",
  "kitchen.pantry",
  "context.get",
  "context.exportData",
];

const PORT = 3457;
const BASE = `http://localhost:${PORT}`;
const dir = mkdtempSync(join(tmpdir(), "demo-fixtures-"));

const env = {
  ...process.env,
  DB_PATH: join(dir, "demo.db"),
  PORT: String(PORT),
  AUTH_URL: BASE,
  AUTH_SECRET: "demo-fixture-recorder-secret",
  ALLOWED_GITHUB_ID: "1000001",
  // No key: generation.available must record as unavailable-free tier — the
  // demo fakes generation client-side anyway — and the planner must take its
  // deterministic path.
  ANTHROPIC_API_KEY: "",
  // The whole point of this recorder: the temp database must never absorb
  // the working tree's seed.local.json.
  SEED_SKIP_LOCAL: "1",
};

// `mintSession` runs in *this* process and reads *this* environment; the
// `env` object above only reaches the children. Without this line the token
// is signed with the working tree's real secret and the temp server 401s.
Object.assign(process.env, {
  AUTH_SECRET: env.AUTH_SECRET,
  AUTH_URL: env.AUTH_URL,
  ALLOWED_GITHUB_ID: env.ALLOWED_GITHUB_ID,
});

const run = (cmd, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env, stdio: "inherit" });
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(" ")} -> ${code}`)),
    );
  });

console.log(`[fixtures] temp db at ${env.DB_PATH}`);
await run("npm", ["run", "db:migrate"]);
await run("npm", ["run", "db:seed"]);

const server = spawn("npm", ["run", "dev"], { env, stdio: "pipe" });
const kill = () => {
  server.kill("SIGTERM");
  rmSync(dir, { recursive: true, force: true });
};
process.on("exit", kill);

for (;;) {
  try {
    await fetch(`${BASE}/healthz`, { signal: AbortSignal.timeout(1000) });
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 400));
  }
}

const { cookieName, token } = await mintSession();
const headers = {
  Cookie: `${cookieName}=${token}`,
  "Content-Type": "application/json",
};

async function call(path, type, input) {
  const url =
    type === "query"
      ? `${BASE}/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify({ json: input ?? {} }))}`
      : `${BASE}/api/trpc/${path}`;
  const res = await fetch(url, {
    method: type === "query" ? "GET" : "POST",
    headers,
    body: type === "mutation" ? JSON.stringify({ json: input ?? {} }) : undefined,
  });
  const body = await res.json();
  if (body.error) throw new Error(`${path}: ${JSON.stringify(body.error).slice(0, 200)}`);
  return body.result?.data?.json ?? null;
}

// Stage a lived-in week rather than a blank slate: complete setup with the
// documented defaults, plan the week, store a leftover, tick two lines.
console.log("[fixtures] staging demo state");
const state = await call("setup.state", "query");
await call("setup.completeWizard", "mutation", {
  profile: state.profile,
  settings: state.settings,
  mealShapes: [],
});
await call("plan.generateWeek", "mutation", { force: true });
await call("kitchen.storePortion", "mutation", {
  recipeName: "Gochujang Beef Bowl",
  storage: "fridge",
});
const grocery = await call("grocery.list", "query");
for (const line of grocery.sections.flatMap((s) => s.lines).slice(0, 2)) {
  await call("grocery.setChecked", "mutation", {
    weekStart: grocery.weekStart,
    key: line.key,
    checked: true,
  });
}

console.log("[fixtures] recording queries");
const fixtures = {};
for (const path of QUERIES) {
  fixtures[path] = await call(path, "query");
  console.log(`  ${path} ✓`);
}

// The recorder ran with no API key, so availability recorded as off — but
// the demo fakes generation client-side, and the gate would hide its best
// feature. Overriding the single flag here keeps the lie small, local and
// documented; everything else stays exactly as the server answered.
fixtures["generation.available"] = { configured: true };

// The streaming transcript: a seed recipe replayed as the generator's
// forced-tool JSON, chunked the way the real stream arrives.
// recipes.list wraps its rows; unwrap whatever shape it is.
const listPayload = fixtures["recipes.list"];
const recipes = Array.isArray(listPayload)
  ? listPayload
  : (listPayload.recipes ?? listPayload.items ?? []);
const star = recipes.find((r) => r.name.includes("Gochujang")) ?? recipes[0];
const body = JSON.stringify(
  { ...star, id: undefined, favorite: undefined },
  null,
  1,
);
const chunks = [];
for (let i = 0; i < body.length; i += 24) chunks.push(body.slice(i, i + 24));
fixtures["__streamTranscript"] = { recipe: star, chunks };

writeFileSync("demo/fixtures.json", JSON.stringify(fixtures, null, 2) + "\n");
console.log(`[fixtures] wrote demo/fixtures.json (${QUERIES.length} paths)`);
process.exit(0);
