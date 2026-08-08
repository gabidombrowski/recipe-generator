#!/usr/bin/env node
import { cpSync, existsSync } from "node:fs";
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
