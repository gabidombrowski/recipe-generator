import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";

/**
 * `npm start`, made to actually work.
 *
 * Two things about standalone output are invisible until they bite. The build
 * has to be `build:standalone`, not `build` — plain `next build` emits a
 * standalone directory with no static assets, which serves unstyled pages and
 * looks like a CSS bug. And the standalone server chdirs into its own
 * directory before loading env files, so the repo root's `.env` — the one the
 * README tells you to create — is silently ignored, and the deploy pipeline
 * deliberately scrubs any `.env` that file-tracing copies in there.
 *
 * So this script does the two missing things: refuses early with the right
 * command when the build is absent, and loads the root `.env` with the same
 * loader Next itself uses before handing off to the server.
 */

const root = process.cwd();
const server = join(root, ".next", "standalone", "server.js");
const staticDir = join(root, ".next", "standalone", ".next", "static");

if (!existsSync(server)) {
  console.error("No standalone build found. Run:  npm run build:standalone");
  process.exit(1);
}
if (!existsSync(staticDir)) {
  console.error(
    "Standalone build has no static assets (pages would render unstyled).\n" +
      "Run:  npm run build:standalone",
  );
  process.exit(1);
}

/**
 * Hand-rolled rather than `@next/env` because that package is Next's internal
 * dependency, not this project's — importing it works only when the package
 * manager happens to hoist it. The format this repo actually uses is plain
 * KEY=VALUE lines, and the one precedence rule that matters is preserved:
 * variables already set in the shell win over the file, so
 * `PORT=4000 npm start` behaves as anyone would expect.
 */
for (const file of [".env", ".env.local"]) {
  const path = join(root, file);
  if (!existsSync(path)) continue;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!match || line.trim().startsWith("#")) continue;
    const [, key, raw] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = raw.replace(/^["']|["']$/g, "");
  }
}

const child = spawn(process.execPath, [server], {
  stdio: "inherit",
  env: process.env,
});
child.on("exit", (code) => process.exit(code ?? 0));
