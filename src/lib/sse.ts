/**
 * Server-sent events, both directions: the encoder the route handler uses and
 * the incremental parser the client feeds network chunks into.
 *
 * Both live in one file because they are two halves of one wire format, and
 * the classic SSE bug lives between them: a frame split across two network
 * chunks. TCP owes nobody frame alignment, so `data: {"name":"So` in one read
 * and `up"}\n\n` in the next is routine — a parser that assumes chunk ==
 * frame works on localhost and corrupts events in production. The parser here
 * is a pure function over (buffer + chunk) precisely so that case is a unit
 * test instead of a bug report.
 */

export interface SseEvent {
  event: string;
  /** JSON payload. Encoded/decoded by these helpers, opaque in between. */
  data: unknown;
}

/** One wire frame. `data:` is a single line because the payload is JSON. */
export function encodeSse(event: SseEvent): string {
  return `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
}

/**
 * Consumes as many complete frames as `buffer + chunk` contains and returns
 * the unconsumed tail to carry into the next call.
 */
export function parseSse(
  buffer: string,
  chunk: string,
): { events: SseEvent[]; rest: string } {
  const text = buffer + chunk;
  const frames = text.split("\n\n");
  // The last segment is either "" (input ended on a frame boundary) or a
  // partial frame — both are the correct carry-over.
  const rest = frames.pop() ?? "";

  const events: SseEvent[] = [];
  for (const frame of frames) {
    let name = "message";
    let data = "";
    for (const line of frame.split("\n")) {
      if (line.startsWith("event: ")) name = line.slice(7);
      else if (line.startsWith("data: ")) data = line.slice(6);
    }
    if (data === "") continue; // comment/heartbeat frames carry no data
    try {
      events.push({ event: name, data: JSON.parse(data) });
    } catch {
      // A frame that split mid-JSON would have been caught by the "\n\n"
      // boundary above; unparseable data here means a producer bug. Dropping
      // it silently would hide that, so it surfaces as a malformed event.
      events.push({ event: "error", data: { message: "malformed SSE frame" } });
    }
  }
  return { events, rest };
}
