/**
 * The demo build: the real UI, a fake spine, no server.
 *
 * A separate Next app rather than a DEMO flag inside the real one, on
 * purpose: the last demo attempt died because runtime flags in shared code
 * kept finding ways to matter (a real profile leaked into the demo database
 * before it shipped). This app cannot leak what it cannot reach — it has no
 * database, no auth, no API key, and `output: "export"` means there is not
 * even a server, just files behind the same nginx alias that serves other
 * static demos on the host.
 *
 * Pages are re-exported from ../src, so the components under demo are the
 * production components; only the data layer is swapped (see lib/demo-link).
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const nextConfig = {
  output: "export",
  // The demo app lives one level below the repo; Turbopack must treat the
  // repo as the workspace root or it refuses to compile ../src and cannot
  // find node_modules.
  turbopack: { root: join(dirname(fileURLToPath(import.meta.url)), "..") },
  basePath: "/recipe-generator",
  distDir: ".next-demo",
  // Static export cannot optimise images at request time.
  images: { unoptimized: true },
  // Directory-per-route output (grocery/index.html) so any static server —
  // nginx alias, python, a CDN — resolves deep links with no rewrite rules,
  // and client-side Links never hard-redirect to a canonical slash form.
  trailingSlash: true,
};

export default nextConfig;
