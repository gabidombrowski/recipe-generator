"use client";

import { Badge, Card, cx } from "./ui";
import { type FormulaLine, type MacroPlan } from "~/lib/macros";

/**
 * The macro engine, shown rather than asserted.
 *
 * Every formula is rendered twice — once in symbols, once with this profile's
 * live numbers substituted — so the arithmetic can be checked by eye. Nothing
 * here is hardcoded; changing any input above recomputes all of it.
 */
export function MacroExplainer({
  plan,
  formulas,
  perMealProtein,
}: {
  plan: MacroPlan;
  formulas: readonly FormulaLine[];
  perMealProtein: { meals: number; gramsPerMeal: number; withinGuide: boolean };
}) {
  const rows = [
    { label: "Training day", targets: plan.training, count: plan.trainingDayCount, tone: "training" as const },
    { label: "Rest day", targets: plan.rest, count: plan.restDayCount, tone: "neutral" as const },
  ];

  const drift = plan.achievedWeeklyMeanKcal - plan.weeklyAverageTarget;

  return (
    <div className="space-y-5">
      <Card title="Daily targets">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-ink-muted uppercase">
                <th className="py-2 pr-4 font-medium">Day type</th>
                <th className="py-2 pr-4 font-medium">Days</th>
                <th className="py-2 pr-4 text-right font-medium">kcal</th>
                <th className="py-2 pr-4 text-right font-medium">Protein</th>
                <th className="py-2 pr-4 text-right font-medium">Carbs</th>
                <th className="py-2 text-right font-medium">Fat</th>
              </tr>
            </thead>
            <tbody className="font-mono tabular-nums">
              {rows.map((row) => (
                <tr key={row.label} className="border-b border-border/60 last:border-0">
                  <td className="py-2 pr-4 font-sans">
                    <Badge tone={row.tone}>{row.label}</Badge>
                  </td>
                  <td className="py-2 pr-4">{row.count}</td>
                  <td className="py-2 pr-4 text-right font-medium">{row.targets.kcal}</td>
                  <td className="py-2 pr-4 text-right">{row.targets.proteinG} g</td>
                  <td className="py-2 pr-4 text-right">{row.targets.carbsG} g</td>
                  <td className="py-2 text-right">{row.targets.fatG} g</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 space-y-1 border-t border-border pt-3 text-xs text-ink-muted">
          <p>
            Weekly average target{" "}
            <strong className="font-mono">{plan.weeklyAverageTarget} kcal</strong>; these
            rounded daily targets actually average{" "}
            <strong className="font-mono">
              {plan.achievedWeeklyMeanKcal.toFixed(1)} kcal
            </strong>{" "}
            ({drift >= 0 ? "+" : ""}
            {drift.toFixed(1)} from rounding).
          </p>
          <p>
            Per-meal protein across {perMealProtein.meals} meals:{" "}
            <strong className="font-mono">{perMealProtein.gramsPerMeal} g</strong>{" "}
            <span className={cx(perMealProtein.withinGuide ? "text-accent" : "text-warn")}>
              {perMealProtein.withinGuide
                ? "(inside the 35-45 g guide)"
                : "(outside the 35-45 g guide)"}
            </span>
          </p>
        </div>
      </Card>

      <Card title="How these numbers are produced">
        <ol className="space-y-3">
          {formulas.map((line) => (
            <li key={line.label} className="border-b border-border/60 pb-3 last:border-0 last:pb-0">
              <p className="text-sm font-medium">{line.label}</p>
              <p className="mt-0.5 font-mono text-xs text-ink-muted">{line.formula}</p>
              <p className="mt-1 font-mono text-sm">
                {line.substituted} <span className="text-ink-muted">=</span>{" "}
                <strong>{line.result}</strong>
              </p>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
