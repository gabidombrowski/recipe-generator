import { type ReactNode } from "react";

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-ink-muted">
      {children}
    </p>
  );
}
