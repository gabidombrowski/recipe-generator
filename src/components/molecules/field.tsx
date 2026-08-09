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
  return (
    <label className="flex flex-col gap-1">
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
