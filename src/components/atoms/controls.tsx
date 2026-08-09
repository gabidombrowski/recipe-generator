import { type ComponentProps } from "react";
import { cx } from "../cx";

/**
 * `text-base sm:text-sm` is a mobile fix, not a type-scale preference.
 *
 * Safari on iOS zooms the viewport whenever a focused control's font is under
 * 16px, and it does not zoom back out afterwards. This app is almost entirely
 * forms, so at 14px every tap into a field left the user zoomed in and panning.
 * 16px on phones buys that back; the 14px design is kept from `sm:` up, where
 * no such behaviour exists.
 *
 * `min-h-11` is the 44px touch target Apple and Android both ask for, again
 * only on small screens.
 */
const CONTROL_CLASS =
  "min-h-11 rounded-lg border border-border bg-surface px-3 py-1.5 " +
  "text-base sm:min-h-0 sm:text-sm " +
  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent";


export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cx(CONTROL_CLASS, className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cx(CONTROL_CLASS, className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      className={cx(CONTROL_CLASS, "font-mono leading-relaxed", className)}
      {...props}
    />
  );
}
