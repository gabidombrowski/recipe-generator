import { describe, expect, it } from "vitest";
import { chunkContext } from "./context";

describe("chunkContext", () => {
  it("returns nothing for empty or whitespace-only input", () => {
    expect(chunkContext("")).toEqual([]);
    expect(chunkContext("   \n\n  \n")).toEqual([]);
  });

  it("splits on headings and carries the heading onto its chunks", () => {
    const chunks = chunkContext(
      ["# Cut", "", "Down 2kg since March.", "", "## Taste", "", "Chickpeas feel heavy."].join(
        "\n",
      ),
    );

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toMatchObject({ heading: "Cut", body: "Down 2kg since March." });
    expect(chunks[1]).toMatchObject({ heading: "Taste", body: "Chickpeas feel heavy." });
  });

  it("keeps prose that appears before any heading", () => {
    const chunks = chunkContext("No heading here.\n\n# Later\n\nUnder a heading.");
    expect(chunks[0]).toMatchObject({ heading: null, body: "No heading here." });
  });

  it("treats a whitespace-only line as a paragraph break", () => {
    // Valid Markdown: the "blank" line between these two holds a space, which
    // a naive /\n{2,}/ split does not see, silently merging the paragraphs.
    const chunks = chunkContext("# H\n\nFirst para.\n \t \nSecond para.");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.body).toBe("First para.\n\nSecond para.");
  });

  it("numbers chunks in file order", () => {
    const chunks = chunkContext("# A\n\nOne.\n\n# B\n\nTwo.\n\n# C\n\nThree.");
    expect(chunks.map((c) => c.ordinal)).toEqual([0, 1, 2]);
  });

  it("packs several short paragraphs together rather than one chunk each", () => {
    const chunks = chunkContext("# H\n\nShort one.\n\nShort two.\n\nShort three.");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.body).toContain("Short one.");
    expect(chunks[0]?.body).toContain("Short three.");
  });

  it("splits once the size cap is passed", () => {
    const paragraph = "x".repeat(700);
    const chunks = chunkContext(`# H\n\n${paragraph}\n\n${paragraph}\n\n${paragraph}`);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.heading).toBe("H");
  });

  it("treats a heading marker with no text as no heading at all", () => {
    // "#   " trims to "", which behaves like null everywhere downstream but
    // would persist as a second, distinct representation of the same thing.
    const chunks = chunkContext("#   \n\nOrphaned prose.");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.heading).toBeNull();
  });

  it("does not cut a single oversized paragraph mid-sentence", () => {
    const huge = "y".repeat(3000);
    const chunks = chunkContext(`# H\n\n${huge}`);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.body).toBe(huge);
  });
});
