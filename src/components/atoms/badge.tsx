import { type ReactNode } from "react";
import { cx } from "../cx";

type BadgeTone = "neutral" | "accent" | "training" | "warn" | "flagged";

const BADGE_STYLES: Record<BadgeTone, string> = {
  neutral: "bg-surface-sunken text-ink-muted",
  accent: "bg-accent-soft text-accent",
  training: "bg-training-soft text-training",
  warn: "bg-warn-soft text-warn",
  flagged: "bg-flagged-soft text-flagged",
};


export function Badge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        BADGE_STYLES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
