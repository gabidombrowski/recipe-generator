import { type ComponentProps } from "react";
import { cx } from "../cx";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-ink hover:opacity-90",
  secondary: "border border-border bg-surface hover:bg-surface-sunken",
  ghost: "text-ink-muted hover:bg-surface-sunken",
  danger: "border border-warn/40 text-warn hover:bg-warn-soft",
};


export function Button({
  variant = "secondary",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant }) {
  return (
    <button
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        "disabled:cursor-not-allowed disabled:opacity-50",
        BUTTON_STYLES[variant],
        className,
      )}
      {...props}
    />
  );
}
