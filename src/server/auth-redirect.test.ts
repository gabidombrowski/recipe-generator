import { describe, expect, it } from "vitest";
import { resolveRedirect } from "./auth-redirect";

/**
 * These pin a bug that shipped: served under a sub-path, a successful sign-in
 * landed on the *host's* home page instead of the app's, because Auth.js
 * resolves a relative target against the origin and knows nothing about a Next
 * `basePath`.
 */

const ORIGIN = "https://example.test";
const PREFIX = "/recipe-generator";

describe("resolveRedirect under a sub-path", () => {
  it("sends a bare root to the app, not the host", () => {
    expect(resolveRedirect("/", ORIGIN, PREFIX)).toBe(
      "https://example.test/recipe-generator/",
    );
  });

  it("prefixes a relative path that lacks it", () => {
    expect(resolveRedirect("/week", ORIGIN, PREFIX)).toBe(
      "https://example.test/recipe-generator/week",
    );
  });

  it("leaves an already-prefixed path alone rather than doubling it", () => {
    expect(resolveRedirect("/recipe-generator/setup", ORIGIN, PREFIX)).toBe(
      "https://example.test/recipe-generator/setup",
    );
  });

  it("does not treat a lookalike sibling path as prefixed", () => {
    // `/recipe-generator-notes` starts with the prefix as a *string* but is not
    // under it, so a naive startsWith check would wrongly leave it un-prefixed.
    expect(resolveRedirect("/recipe-generator-notes", ORIGIN, PREFIX)).toBe(
      "https://example.test/recipe-generator/recipe-generator-notes",
    );
  });

  it("keeps an absolute same-origin URL", () => {
    const url = "https://example.test/recipe-generator/library";
    expect(resolveRedirect(url, ORIGIN, PREFIX)).toBe(url);
  });

  it("refuses to leave the origin", () => {
    expect(resolveRedirect("https://elsewhere.test/steal", ORIGIN, PREFIX)).toBe(
      "https://example.test/recipe-generator/",
    );
  });

  it("falls back to the app home for a value that is not a URL", () => {
    expect(resolveRedirect("not a url", ORIGIN, PREFIX)).toBe(
      "https://example.test/recipe-generator/",
    );
  });
});

describe("resolveRedirect at the root", () => {
  it("behaves like the library default", () => {
    expect(resolveRedirect("/", ORIGIN, "")).toBe("https://example.test/");
    expect(resolveRedirect("/week", ORIGIN, "")).toBe(
      "https://example.test/week",
    );
  });

  it("still refuses to leave the origin", () => {
    expect(resolveRedirect("https://elsewhere.test/steal", ORIGIN, "")).toBe(
      "https://example.test/",
    );
  });
});
