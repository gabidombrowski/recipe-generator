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
