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
        "rounded-xl border border-border bg-surface p-5 shadow-sm",
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
