import { cx } from "../cx";

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
