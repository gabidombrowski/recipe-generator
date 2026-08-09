import { type ReactNode } from "react";
import { cx } from "../cx";

export function PageTitle({
  children,
  subdued = false,
  className,
}: {
  children: ReactNode;
  subdued?: boolean;
  className?: string;
}) {
  if (subdued) {
    return (
      <h1 className={cx("font-display text-2xl tracking-wide", className)}>
        {children}
      </h1>
    );
  }
  return (
    <h1 className={cx("plate plate--title text-2xl", className)}>{children}</h1>
  );
}
