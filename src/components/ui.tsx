import { type ComponentProps, type ReactNode } from "react";

/**
 * Shared primitives.
 *
 * Deliberately small and unabstracted — this app has one developer and a dozen
 * screens, so a handful of styled elements beats a component library. Anything
 * used in exactly one place stays in that place.
 */

export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

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
            <h2 className="text-sm font-semibold tracking-wide text-ink-muted uppercase">
              {title}
            </h2>
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

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary: "bg-accent text-white hover:opacity-90",
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

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-ink-muted">{hint}</span>}
    </label>
  );
}

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
    <textarea className={cx(CONTROL_CLASS, "font-mono leading-relaxed", className)} {...props} />
  );
}

/** Multi-select over the days of the week, used for training/cook/assembly days. */
export function DayPicker({
  days,
  selected,
  onChange,
}: {
  days: readonly string[];
  selected: readonly string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {days.map((day) => {
        const isSelected = selected.includes(day);
        return (
          <button
            key={day}
            type="button"
            aria-pressed={isSelected}
            onClick={() =>
              onChange(
                isSelected ? selected.filter((d) => d !== day) : [...selected, day],
              )
            }
            className={cx(
              "rounded-lg border px-2.5 py-1 text-xs font-medium transition",
              isSelected
                ? "border-accent bg-accent-soft text-accent"
                : "border-border text-ink-muted hover:bg-surface-sunken",
            )}
          >
            {day.slice(0, 3)}
          </button>
        );
      })}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-ink-muted">
      {children}
    </p>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <p className="py-8 text-center text-sm text-ink-muted" role="status">
      {label}...
    </p>
  );
}

/** Macro figures, rendered the same way everywhere they appear. */
export function MacroRow({
  kcal,
  proteinG,
  carbsG,
  fatG,
}: {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}) {
  const items = [
    ["kcal", Math.round(kcal), ""],
    ["protein", Math.round(proteinG), "g"],
    ["carbs", Math.round(carbsG), "g"],
    ["fat", Math.round(fatG), "g"],
  ] as const;

  return (
    <dl className="flex flex-wrap gap-x-5 gap-y-1">
      {items.map(([label, value, unit]) => (
        <div key={label} className="flex items-baseline gap-1">
          <dt className="text-xs text-ink-muted">{label}</dt>
          <dd className="font-mono text-sm font-medium tabular-nums">
            {value}
            {unit}
          </dd>
        </div>
      ))}
    </dl>
  );
}
