import { type ReactNode } from "react";

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  // `min-w-0` for the same reason as Card: as a flex item this label would
  // otherwise be floored at its own min-content. An input's *placeholder*
  // counts toward that, so a long example sentence — never real content — is
  // enough to push the field off the side of a narrow screen.
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-ink-muted">{hint}</span>}
    </label>
  );
}

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
