import { afterEach, describe, expect, it, vi } from "vitest";

const settings = { aiEnabled: true };
vi.mock("~/server/db/state", () => ({ getSettings: () => settings }));

const { aiStatus } = await import("./availability");

describe("aiStatus", () => {
  const original = process.env.ANTHROPIC_API_KEY;
  afterEach(() => {
    process.env.ANTHROPIC_API_KEY = original;
    settings.aiEnabled = true;
  });

  it("is available with a key and AI switched on", () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    expect(aiStatus()).toEqual({ available: true, reason: null });
  });

  it("says the key is missing first", () => {
    process.env.ANTHROPIC_API_KEY = "";
    settings.aiEnabled = false;
    expect(aiStatus().reason).toMatch(/ANTHROPIC_API_KEY/);
  });

  it("is unavailable when switched off, even with a key", () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    settings.aiEnabled = false;
    expect(aiStatus()).toEqual({
      available: false,
      reason: "AI generation is turned off in Settings",
    });
  });
});
