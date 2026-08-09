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

/**
 * The page heading, as a peach plate.
 *
 * Every page had its own `<h1 className="text-2xl font-semibold">`, so the
 * motif would have been nine copies of the same class string waiting to drift
 * apart. `subdued` exists for headings that are mostly data — "Week of
 * 2026-08-10" — where a slab of peach around a date reads as decoration
 * rather than as a title.
 */
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
      <h1 className={cx("font-display text-2xl tracking-wide", className)}>{children}</h1>
    );
  }
  return (
    <h1 className={cx("plate plate--title text-2xl", className)}>{children}</h1>
  );
}

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

/**
 * Aligns an unlabelled control — usually a submit button — with the inputs in a
 * horizontal row of `Field`s.
 *
 * A row of fields cannot be bottom-aligned, because `Field` puts its `hint`
 * *below* the control: bottom-aligning the boxes sits a hinted field's input a
 * line higher than an unhinted one, which is what put the tag-limit row's
 * inputs on two different baselines. The row is top-aligned instead, so every
 * control clears an identical single-line label. That leaves a bare button
 * floating at the top, so this reserves the same label-sized box above it.
 */
export function FieldAction({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span aria-hidden className="invisible text-sm font-medium select-none">
        &nbsp;
      </span>
      {children}
    </div>
  );
}

/**
 * A small "i" that reveals an explanation on hover or keyboard focus.
 *
 * The text is the button's accessible name and the bubble is `aria-hidden`, so
 * a screen reader gets it once from the control rather than twice. That also
 * avoids `useId`, which would make this a client-only component and stop it
 * being used from a server-rendered page.
 *
 * `group-focus-within` matters as much as `group-hover`: a hint reachable only
 * by mouse is not reachable at all for anyone tabbing through the page.
 */
export function InfoHint({ children }: { children: string }) {
  return (
    <span className="group relative inline-flex items-center">
      <button
        type="button"
        aria-label={children}
        className={cx(
          "flex size-4 items-center justify-center rounded-full border border-border",
          "font-display text-[10px] leading-none text-ink-muted",
          "hover:border-accent hover:text-accent",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        )}
      >
        i
      </button>
      <span
        aria-hidden
        role="tooltip"
        className={cx(
          "pointer-events-none invisible absolute top-full right-0 z-20 mt-1.5 w-60",
          "rounded-lg border border-border bg-surface p-2 text-left text-xs font-normal",
          "text-ink-muted normal-case shadow-md",
          "group-hover:visible group-focus-within:visible",
        )}
      >
        {children}
      </span>
    </span>
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
