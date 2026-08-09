import { describe, expect, it } from "vitest";
import { isSaved } from "./library";

/**
 * What belongs in the library.
 *
 * The generator writes every recipe it produces to the database immediately,
 * because the planner assigns by id — so the table is a transcript and the
 * library is the subset someone chose to keep.
 */
describe("library membership", () => {
  it("keeps seeded recipes without needing them favourited", () => {
    // Otherwise a fresh install opens on an empty shelf.
    expect(isSaved({ source: "seed", favorite: false })).toBe(true);
  });

  it("keeps hand-entered recipes without needing them favourited", () => {
    // Typing a recipe in *is* the act of keeping it.
    expect(isSaved({ source: "manual", favorite: false })).toBe(true);
  });

  it("hides an AI recipe until it is explicitly saved", () => {
    expect(isSaved({ source: "ai", favorite: false })).toBe(false);
  });

  it("keeps an AI recipe once saved", () => {
    expect(isSaved({ source: "ai", favorite: true })).toBe(true);
  });
});
