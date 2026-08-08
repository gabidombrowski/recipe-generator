import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

/**
 * Security headers applied to every response. The CSP is deliberately a
 * baseline rather than a lockdown: `unsafe-inline` on styles is required by
 * Tailwind's runtime-injected styles, and `unsafe-eval` is omitted entirely.
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
      "script-src 'self' 'unsafe-inline'",
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
