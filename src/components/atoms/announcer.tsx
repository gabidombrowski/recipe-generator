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
const ERROR_EVENT = "app:announce-error";

export function announce(message: string): void {
  window.dispatchEvent(new CustomEvent<string>(EVENT, { detail: message }));
}

/**
 * For failures. Rendered as a visible banner as well as spoken, because the
 * quiet version already burned us: a stale tab spent an afternoon failing
 * every write while looking exactly like success, and the user redid work
 * that was never landing. An error the user cannot see is indistinguishable
 * from no error.
 */
export function announceError(message: string): void {
  window.dispatchEvent(
    new CustomEvent<string>(ERROR_EVENT, { detail: message }),
  );
}

export function Announcer() {
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let pending: ReturnType<typeof setTimeout> | undefined;
    const onAnnounce = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      // Clear first so repeating the same message still triggers a
      // re-announcement — live regions only speak on *change*. The re-set is
      // a macrotask, NOT requestAnimationFrame: Chrome stops firing frames in
      // a hidden tab, and an announcement queued behind a frame that never
      // comes is an announcement that never happens — found by driving this
      // in a hidden automation pane, which is exactly a backgrounded tab.
      clearTimeout(pending);
      setMessage("");
      pending = setTimeout(() => setMessage(detail), 0);
    };
    window.addEventListener(EVENT, onAnnounce);

    let errorTimer: ReturnType<typeof setTimeout> | undefined;
    const onError = (event: Event) => {
      clearTimeout(errorTimer);
      setError((event as CustomEvent<string>).detail);
      // Long enough to read twice; dismissable sooner. Not permanent, because
      // a banner that outlives its failure becomes wallpaper.
      errorTimer = setTimeout(() => setError(null), 10_000);
    };
    window.addEventListener(ERROR_EVENT, onError);

    return () => {
      clearTimeout(pending);
      clearTimeout(errorTimer);
      window.removeEventListener(EVENT, onAnnounce);
      window.removeEventListener(ERROR_EVENT, onError);
    };
  }, []);

  return (
    <>
      <div aria-live="polite" role="status" className="sr-only">
        {message}
      </div>
      {error && (
        <div
          role="alert"
          className="fixed inset-x-3 bottom-3 z-50 mx-auto flex max-w-xl items-center justify-between gap-3 rounded-lg border border-warn/40 bg-warn-soft px-4 py-3 text-sm text-warn shadow-lg"
        >
          <span className="min-w-0">{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            aria-label="Dismiss error"
            className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg font-medium hover:bg-warn/10"
          >
            ×
          </button>
        </div>
      )}
    </>
  );
}
