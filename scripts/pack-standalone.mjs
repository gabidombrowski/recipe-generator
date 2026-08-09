#!/usr/bin/env node
import { cpSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

/**
 * Completes the standalone output.
 *
 * `output: "standalone"` deliberately omits the static assets and anything read
 * from disk at runtime, so the build artifact is not runnable as-is. This adds:
 *
 *   .next/static  — client bundles and CSS
 *   public/       — static files
 *   drizzle/      — migrations, applied at boot by instrumentation.ts
 *   prompts/      — read and hashed at generation time, not bundled
 *
 * Both the deploy workflow and the Playwright smoke tests run this, so the
 * thing tested locally is the same artifact that ships.
 */

const root = process.cwd();
const standalone = join(root, ".next", "standalone");

if (!existsSync(standalone)) {
  console.error("No .next/standalone — run `npm run build` first.");
  process.exit(1);
}

const copies = [
  [join(root, ".next", "static"), join(standalone, ".next", "static")],
  [join(root, "public"), join(standalone, "public")],
  [join(root, "drizzle"), join(standalone, "drizzle")],
  [join(root, "prompts"), join(standalone, "prompts")],
];

for (const [from, to] of copies) {
  if (!existsSync(from)) continue;
  cpSync(from, to, { recursive: true });
  console.log(`packed ${from.replace(`${root}/`, "")}`);
}

/**
 * Scrub secrets and personal data from the artifact.
 *
 * `deploy.yml` rsyncs this directory to the server, so anything left here is
 * shipped. Next traces the whole project into the standalone output — it warns
 * that it is doing so, because `seed.local.json` is read through a computed
 * path it cannot follow — which sweeps up `.env`, the local seed, and any
 * database sitting in `data/`.
 *
 * A CI build never has those files, so what has actually shipped was clean. A
 * build on a developer machine is not: it carries a real `AUTH_SECRET`, a real
 * API key and a real profile. `next.config.ts` also lists them under
 * `outputFileTracingExcludes`, but that alone did not keep them out — this
 * runs on the finished artifact, which is the last point where being wrong is
 * still recoverable.
 *
 * Deleting rather than warning is deliberate. A warning in a build log is a
 * warning nobody reads at 11pm.
 */
const scrub = [
  ".env",
  ".env.local",
  ".env.production",
  "seed.local.json",
  "nutrition-context.md",
  "data",
  "tests/e2e/.auth",
];

for (const relative of scrub) {
  const target = join(standalone, relative);
  if (!existsSync(target)) continue;
  rmSync(target, { recursive: true, force: true });
  console.log(`scrubbed ${relative} from the artifact`);
}
