import { type ComponentProps } from "react";
import { cx } from "../cx";

const CONTROL_CLASS =
  "rounded-lg border border-border bg-surface px-3 py-1.5 text-sm " +
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
