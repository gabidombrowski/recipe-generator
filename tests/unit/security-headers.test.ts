import { afterEach, describe, expect, it, vi } from "vitest";
import type { NextConfig } from "next";

/**
 * The CSP is the one security header that varies by environment, which makes it
 * the one that can regress without anybody noticing.
 *
 * React's development build needs `eval()` for its error overlay, so dev
 * responses carry `unsafe-eval`. Production must never carry it. That is a
 * conditional on `NODE_ENV` inside a config file nothing else tests — exactly
 * the shape of thing that gets "simplified" later into an unconditional string.
 */

/** Loads next.config.ts fresh under a given NODE_ENV. */
async function cspUnder(nodeEnv: string): Promise<string> {
  // The header array is built at module scope, so the env has to be set before
  // the import and the module registry has to be dropped between cases.
  vi.stubEnv("NODE_ENV", nodeEnv);
  vi.resetModules();

  const loaded = (await import("../../next.config")) as { default: NextConfig };
  const groups = await loaded.default.headers!();

  const csp = groups
    .flatMap((group) => group.headers)
    .find((header) => header.key === "Content-Security-Policy");

  if (!csp) throw new Error(`no Content-Security-Policy header under NODE_ENV=${nodeEnv}`);
  return csp.value;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("content security policy", () => {
  it("never allows eval in production", async () => {
    expect(await cspUnder("production")).not.toContain("unsafe-eval");
  });

  it("allows eval in development, so the React error overlay works", async () => {
    expect(await cspUnder("development")).toContain("'unsafe-eval'");
  });

  it.each(["production", "development"])(
    "keeps the rest of the policy identical under NODE_ENV=%s",
    async (nodeEnv) => {
      // `unsafe-eval` is the only thing allowed to differ between environments.
      // If a future edit relaxes something else for dev convenience, that
      // divergence should fail here rather than ship.
      const csp = await cspUnder(nodeEnv);

      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("base-uri 'self'");
      expect(csp).toContain("form-action 'self'");
      expect(csp).toContain("connect-src 'self'");
    },
  );

  it("still ships the non-CSP hardening headers", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.resetModules();

    const loaded = (await import("../../next.config")) as { default: NextConfig };
    const headers = (await loaded.default.headers!()).flatMap((group) => group.headers);
    const byKey = new Map(headers.map((header) => [header.key, header.value]));

    expect(byKey.get("X-Content-Type-Options")).toBe("nosniff");
    expect(byKey.get("X-Frame-Options")).toBe("DENY");
    expect(byKey.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(byKey.get("Strict-Transport-Security")).toContain("max-age=");
  });
});
