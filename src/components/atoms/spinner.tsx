export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <p className="py-8 text-center text-sm text-ink-muted" role="status">
      {label}...
    </p>
  );
}
