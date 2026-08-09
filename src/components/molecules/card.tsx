import { type ReactNode } from "react";
import { cx } from "../cx";

export function Card({
  title,
  action,
  children,
  className,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cx(
        // `min-w-0` because a Card is often a grid or flex item, and such an
        // item defaults to `min-width: auto` — a floor of its own min-content.
        // One unbreakable child (a `<select>` sized by its longest `<option>`)
        // then widens the card past its container and scrolls the whole page
        // sideways on a phone. A no-op in normal flow, so it is safe here
        // rather than at each call site.
        "min-w-0 rounded-xl border border-border bg-surface p-5 shadow-sm",
        className,
      )}
    >
      {(title || action) && (
        <header className="mb-4 flex items-baseline justify-between gap-3">
          {typeof title === "string" ? (
            <h2 className="plate plate--section text-xs">{title}</h2>
          ) : (
            title
          )}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}
