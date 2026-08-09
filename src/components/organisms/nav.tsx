"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "~/components/cx";

/**
 * Main navigation.
 *
 * Two presentations of one list. From `sm:` up it is the horizontal tab bar it
 * has always been. Below that it collapses to a hamburger and a drawer, because
 * eight tabs in a horizontally scrolling strip hide their own contents: the
 * last three were reachable only by a swipe nothing on screen advertised.
 *
 * The drawer is a modal dialog and behaves like one — Escape closes it, focus
 * moves in on open and returns to the button on close, Tab is trapped inside
 * while it is open, and the page behind it cannot scroll. That is the part
 * worth writing by hand rather than approximating: a drawer that leaks focus to
 * the page behind it is worse for a keyboard user than the scrolling strip it
 * replaced.
 */

const LINKS = [
  { href: "/", label: "Today" },
  { href: "/week", label: "Week" },
  { href: "/grocery", label: "Grocery" },
  { href: "/generate", label: "Generate" },
  { href: "/library", label: "Library" },
  { href: "/kitchen", label: "Kitchen" },
  { href: "/context", label: "Context" },
  { href: "/settings", label: "Settings" },
] as const;

const isActive = (href: string, pathname: string) =>
  href === "/" ? pathname === "/" : pathname.startsWith(href);

const linkClass = (active: boolean) =>
  cx(
    "font-display text-sm tracking-wide whitespace-nowrap uppercase transition",
    active
      ? "bg-accent text-accent-ink"
      : "text-ink-muted hover:bg-surface-sunken hover:text-ink",
  );

export function Nav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  // A tap on a link navigates without unmounting the drawer, so closing has to
  // be driven by the route. Adjusted during render rather than in an effect —
  // React's documented pattern for reacting to a changed value, and it avoids
  // the extra pass a setState-inside-useEffect would cost. Covers back and
  // forward too, which an onClick on each link would miss.
  const [routeWhenRendered, setRouteWhenRendered] = useState(pathname);
  if (pathname !== routeWhenRendered) {
    setRouteWhenRendered(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;

    const drawer = drawerRef.current;
    const menuButton = menuButtonRef.current;
    drawer?.querySelector<HTMLElement>("a, button")?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = drawer?.querySelectorAll<HTMLElement>(
        "a[href], button:not([disabled])",
      );
      if (!focusable?.length) return;

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      // Focus returns to the button that opened it, which is the only thing
      // that ever opens it. An earlier version restored whatever had focus
      // beforehand, but that is `document.body` when the button was activated
      // without first being focused — and `body.focus()` silently does
      // nothing, so focus was simply lost. Guarded on focus still being inside
      // the drawer, so a close triggered by navigation does not yank it back
      // from wherever the new page has put it.
      if (drawer?.contains(document.activeElement)) {
        menuButton?.focus();
      }
    };
  }, [open]);

  return (
    <>
      {/*
        Placed before the nav so it is the first thing a keyboard or screen
        reader user reaches. Visually hidden until focused.
      */}
      <a
        href="#main"
        className={cx(
          "sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50",
          "focus:rounded-lg focus:bg-accent focus:px-3 focus:py-2",
          "focus:font-display focus:text-sm focus:text-accent-ink focus:uppercase",
        )}
      >
        Skip to content
      </a>

      <nav
        aria-label="Main"
        className="sticky top-0 z-30 border-b border-border bg-canvas/85 backdrop-blur"
      >
        {/* Mobile bar: just the menu button. No section title — every page
            already leads with its own `PageTitle`, so a label here repeats it
            one line above itself. */}
        <div className="flex items-center px-2 py-1.5 sm:hidden">
          <button
            ref={menuButtonRef}
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open main menu"
            aria-expanded={open}
            aria-controls="main-menu"
            className={cx(
              "flex size-11 shrink-0 items-center justify-center rounded-lg",
              "text-ink-muted transition hover:bg-surface-sunken hover:text-ink",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
            )}
          >
            {/* Drawn as three bars rather than an icon font or an SVG import —
                three spans is less machinery than either, and `bg-current`
                means the hover and focus colours come free from the button.
                `aria-hidden` because the button's `aria-label` already names
                it; without this a screen reader announces the decoration too. */}
            <span aria-hidden className="flex w-[18px] flex-col gap-[4px]">
              <span className="h-[2px] rounded-full bg-current" />
              <span className="h-[2px] rounded-full bg-current" />
              <span className="h-[2px] rounded-full bg-current" />
            </span>
          </button>
        </div>

        {/* Desktop tab bar. */}
        <ul className="mx-auto hidden max-w-5xl gap-1 overflow-x-auto px-4 py-2 sm:flex">
          {LINKS.map(({ href, label }) => {
            const active = isActive(href, pathname);
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "block rounded-lg px-3 py-1.5",
                    linkClass(active),
                  )}
                >
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Backdrop. Rendered only when open so it cannot swallow taps otherwise. */}
      {open && (
        <div
          aria-hidden
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-ink/40 backdrop-blur-[2px] sm:hidden"
        />
      )}

      <div
        ref={drawerRef}
        id="main-menu"
        role="dialog"
        aria-modal="true"
        aria-label="Main menu"
        // Kept mounted so the slide has something to animate from, and hidden
        // from assistive tech and the tab order while closed.
        inert={!open}
        className={cx(
          "fixed inset-y-0 left-0 z-50 w-72 max-w-[80vw] border-r border-border bg-canvas",
          "flex flex-col p-3 shadow-xl transition-transform duration-200 ease-out",
          "motion-reduce:transition-none sm:hidden",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="mb-2 flex items-center justify-between pl-2">
          <span className="font-display text-base tracking-wide uppercase">
            Recipe Generator
          </span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close main menu"
            className={cx(
              "flex size-11 items-center justify-center rounded-lg text-lg",
              "text-ink-muted transition hover:bg-surface-sunken hover:text-ink",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
            )}
          >
            ×
          </button>
        </div>

        <ul className="flex flex-col gap-1">
          {LINKS.map(({ href, label }) => {
            const active = isActive(href, pathname);
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "flex min-h-11 items-center rounded-lg px-3",
                    linkClass(active),
                  )}
                >
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}
