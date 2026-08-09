import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

/**
 * Security headers applied to every response. The CSP is deliberately a
 * baseline rather than a lockdown: `unsafe-inline` on styles is required by
 * Tailwind's runtime-injected styles, and `unsafe-eval` is omitted from every
 * production response.
 */
const securityHeaders = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "img-src 'self' data: blob:",
      "style-src 'self' 'unsafe-inline'",
      // Next's App Router bootstrap uses inline scripts keyed to the build.
      // `unsafe-eval` is added in development only: React's dev build uses
      // eval() for the error overlay and callstack reconstruction, and without
      // it the dev experience degrades silently. Production never gets it.
      `script-src 'self' 'unsafe-inline'${
        process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'"
      }`,
      "connect-src 'self'",
      "font-src 'self' data:",
      "upgrade-insecure-requests",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,

  /**
   * Serve the app under a sub-path — set `NEXT_PUBLIC_BASE_PATH` to something
   * like `/app` to run it behind another site's reverse proxy. Unset, which is
   * the default, serves at the root and nothing changes. The value is supplied
   * by the environment precisely so no deployment's URL is written down here.
   *
   * Baked in at build time rather than read at runtime, because Next rewrites
   * every asset URL and route with it — a build made without it cannot be
   * moved under a sub-path afterwards.
   *
   * `NEXT_PUBLIC_` is load-bearing, not a habit. The middleware needs this
   * value too, and it receives paths with the prefix still attached; the
   * ordinary `env` config does not reach the middleware bundle, so the prefix
   * is what actually gets it inlined there. Found by running a sub-path build
   * and watching `/healthz` redirect to sign-in.
   */
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || undefined,

  /**
   * Pin file tracing to this directory. Without it, Next walks up looking for a
   * workspace root and can pick up unrelated files from a parent directory —
   * which makes the standalone output depend on where the repo happens to be
   * checked out.
   */
  outputFileTracingRoot: dirname(fileURLToPath(import.meta.url)),

  /**
   * Packages that static tracing cannot find.
   *
   * `sqlite-vec` picks its native binary with a computed require —
   * `sqlite-vec-${platform}-${arch}` — and `onnxruntime-node` resolves its
   * `.node` binding the same way. Tracing sees no literal specifier, so neither
   * ends up in the standalone output, and the app silently starts with
   * `vectorSearch: "unavailable"`. That degradation is handled gracefully, which
   * is exactly what makes it easy to miss.
   *
   * This applies to the standalone output itself, so it fixes both deployment
   * paths — the rsync + pm2 one as well as the container.
   */
  outputFileTracingIncludes: {
    "/**": [
      "./node_modules/sqlite-vec/**",
      "./node_modules/sqlite-vec-*/**",
      "./node_modules/onnxruntime-node/**",
    ],
  },

  /**
   * Keep secrets and personal data out of the build artifact.
   *
   * `src/server/db/seed.ts` reads `seed.local.json` through a computed path.
   * Next cannot follow that statically, so it gives up and traces the *whole
   * project* into `.next/standalone` — the build even warns about it
   * ("Dynamic filesystem access causes tracing of the whole project"). The
   * result is that `.env`, `seed.local.json` and any local `data/*.db` get
   * copied into the output.
   *
   * That matters because `deploy.yml` rsyncs `.next/standalone/` to the server.
   * A CI build never sees these files, so the deployed artifact has been clean —
   * but a build run on a developer machine carries a real `AUTH_SECRET`, a real
   * API key and a real profile, and would copy all three to whatever host it is
   * sent to.
   *
   * Measured honestly: these excludes alone did **not** stop `.env` and
   * `seed.local.json` reaching the output — a rebuild still produced both, and
   * `scripts/pack-standalone.mjs` is what actually removes them. They are kept
   * because they cost nothing and narrow what gets traced, but the scrub in the
   * pack step is the mechanism to rely on. Do not delete it on the strength of
   * this block.
   */
  outputFileTracingExcludes: {
    "/**": [
      "./.env*",
      "./seed.local.json",
      "./nutrition-context.md",
      "./data/**",
      "./**/*.db",
      "./**/*.db-wal",
      "./**/*.db-shm",
      "./.git/**",
      "./tests/e2e/.auth/**",
    ],
  },

  /**
   * Native and heavyweight modules must stay outside the bundler: better-sqlite3
   * and sqlite-vec ship `.node` binaries, transformers.js lazily loads an ONNX
   * runtime, and the OTel SDK relies on module-patching that webpack breaks.
   */
  serverExternalPackages: [
    "better-sqlite3",
    "sqlite-vec",
    "@xenova/transformers",
    "pino",
    "@opentelemetry/sdk-node",
    "@opentelemetry/exporter-prometheus",
    "node-cron",
  ],

  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
