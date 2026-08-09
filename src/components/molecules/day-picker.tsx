import { cx } from "../cx";

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
                isSelected
                  ? selected.filter((d) => d !== day)
                  : [...selected, day],
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
