"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "./ui";

const LINKS = [
  { href: "/", label: "Today" },
  { href: "/week", label: "Week" },
  { href: "/grocery", label: "Grocery" },
  { href: "/library", label: "Library" },
  { href: "/kitchen", label: "Kitchen" },
  { href: "/context", label: "Context" },
  { href: "/settings", label: "Settings" },
] as const;

export function Nav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main"
      className="sticky top-0 z-10 border-b border-border bg-canvas/85 backdrop-blur"
    >
      <ul className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-4 py-2">
        {LINKS.map(({ href, label }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "block rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap transition",
                  active
                    ? "bg-accent-soft text-accent"
                    : "text-ink-muted hover:bg-surface-sunken",
                )}
              >
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
