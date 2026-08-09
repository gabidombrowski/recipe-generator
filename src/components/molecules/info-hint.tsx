"use client";

import { useCallback, useId, useLayoutEffect, useRef, useState } from "react";
import { cx } from "../cx";

/**
 * A small "i" that reveals an explanatory note on hover or focus.
 *
 * Positioned in JavaScript rather than CSS, which is the whole reason this is a
 * client component. The tooltip is a fixed-width panel anchored to a trigger
 * that can sit anywhere on the line, so on a narrow screen the panel ran off
 * the side and clipped its own first few characters. There is no pure-CSS way
 * to say "next to this element, but never past the edge of the window" — the
 * clamp needs both rects, so it needs measuring.
 *
 * `position: fixed` so the panel escapes any scrolling or clipping ancestor and
 * is clamped against the viewport, which is the thing it must actually fit in.
 */
export function InfoHint({ children }: { children: string }) {
  const [shown, setShown] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const id = useId();

  /** Places the panel under the trigger, then pulls it back inside the window. */
  const place = useCallback(() => {
    const trigger = triggerRef.current?.getBoundingClientRect();
    const tip = tipRef.current?.getBoundingClientRect();
    if (!trigger || !tip) return;

    const margin = 8;
    const preferred = trigger.right - tip.width; // right-aligned to the trigger
    const maxLeft = window.innerWidth - tip.width - margin;
    const left = Math.max(margin, Math.min(preferred, maxLeft));

    // Flip above the trigger when there is not room below it.
    const below = trigger.bottom + 6;
    const fitsBelow = below + tip.height <= window.innerHeight - margin;
    const top = fitsBelow ? below : Math.max(margin, trigger.top - tip.height - 6);

    setPos({ top, left });
  }, []);

  // Layout effect so the panel is measured and moved before paint; otherwise it
  // is visible for one frame in the wrong place.
  useLayoutEffect(() => {
    if (!shown) return;
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [shown, place]);

  return (
    <span className="relative inline-flex items-center">
      <button
        ref={triggerRef}
        type="button"
        aria-label={children}
        aria-describedby={shown ? id : undefined}
        onMouseEnter={() => setShown(true)}
        onMouseLeave={() => setShown(false)}
        onFocus={() => setShown(true)}
        onBlur={() => setShown(false)}
        onKeyDown={(event) => event.key === "Escape" && setShown(false)}
        className={cx(
          "relative flex size-4 items-center justify-center rounded-full border border-border",
          "font-display text-[10px] leading-none text-ink-muted",
          // A 16px circle is a fine mark and an unusable target. The
          // pseudo-element widens the hit area to 32px without touching layout,
          // so the badge keeps its size next to the control it annotates.
          "before:absolute before:-inset-2 before:content-['']",
          "hover:border-accent hover:text-accent",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        )}
      >
        i
      </button>

      <span
        ref={tipRef}
        id={id}
        role="tooltip"
        className={cx(
          "pointer-events-none fixed z-50 w-60 max-w-[calc(100vw-1rem)]",
          "rounded-lg border border-border bg-surface p-2 text-left text-xs font-normal",
          "text-ink-muted normal-case shadow-md",
          // Hidden rather than unmounted so it can be measured before it shows.
          // `invisible` still lays out; `display: none` would measure as zero.
          shown && pos ? "visible" : "invisible",
        )}
        style={{ top: pos?.top ?? 0, left: pos?.left ?? 0 }}
      >
        {children}
      </span>
    </span>
  );
}
