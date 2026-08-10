import { describe, expect, it } from "vitest";
import { encodeSse, parseSse } from "./sse";

describe("sse round trip", () => {
  it("decodes what it encodes", () => {
    const wire = encodeSse({ event: "delta", data: { text: "chick" } });
    const { events, rest } = parseSse("", wire);
    expect(events).toEqual([{ event: "delta", data: { text: "chick" } }]);
    expect(rest).toBe("");
  });

  it("survives a frame split across chunks — the classic SSE bug", () => {
    const wire = encodeSse({ event: "done", data: { name: "Soup" } });
    const cut = wire.indexOf('"So');

    const first = parseSse("", wire.slice(0, cut));
    expect(first.events).toEqual([]); // nothing complete yet

    const second = parseSse(first.rest, wire.slice(cut));
    expect(second.events).toEqual([{ event: "done", data: { name: "Soup" } }]);
    expect(second.rest).toBe("");
  });

  it("handles several frames in one chunk", () => {
    const wire =
      encodeSse({ event: "attempt", data: { n: 1 } }) +
      encodeSse({ event: "delta", data: { text: "a" } });
    const { events } = parseSse("", wire);
    expect(events.map((e) => e.event)).toEqual(["attempt", "delta"]);
  });

  it("carries JSON containing the frame delimiter safely", () => {
    // JSON.stringify escapes newlines, so a payload containing "\n\n" cannot
    // forge a frame boundary. This pins that assumption.
    const wire = encodeSse({ event: "delta", data: { text: "a\n\nb" } });
    const { events } = parseSse("", wire);
    expect(events[0]?.data).toEqual({ text: "a\n\nb" });
  });

  it("surfaces a malformed frame instead of dropping it", () => {
    const { events } = parseSse("", "event: delta\ndata: {broken\n\n");
    expect(events[0]?.event).toBe("error");
  });
});
