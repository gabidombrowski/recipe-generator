"use client";

import { useEffect, useState } from "react";

/**
 * The screen-reader announcement channel.
 *
 * Async work in this app finishes silently: a grocery item ticks, settings
 * save, a recipe arrives — visually obvious, announced to assistive tech not
 * at all. This pair fixes that with one polite live region for the whole app
 * plus an `announce()` any client component can call.
 *
 * An event on `window` rather than React context on purpose: announcements
 * cross the router's layout boundaries (the region lives in the root layout,
 * callers live anywhere), and a context provider would have to wrap the
 * entire tree to be reachable — one more client boundary for what is, in the
 * end, a fire-and-forget string.
 *
 * `polite`, never `assertive`: nothing here is urgent enough to interrupt the
 * user mid-word. Errors already render `role="alert"` where they happen.
 */

const EVENT = "app:announce";

export function announce(message: string): void {
  window.dispatchEvent(new CustomEvent<string>(EVENT, { detail: message }));
}

export function Announcer() {
  const [message, setMessage] = useState("");

  useEffect(() => {
    const onAnnounce = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      // Clear first so repeating the same message still triggers a
      // re-announcement — live regions only speak on *change*.
      setMessage("");
      requestAnimationFrame(() => setMessage(detail));
    };
    window.addEventListener(EVENT, onAnnounce);
    return () => window.removeEventListener(EVENT, onAnnounce);
  }, []);

  return (
    <div aria-live="polite" role="status" className="sr-only">
      {message}
    </div>
  );
}
