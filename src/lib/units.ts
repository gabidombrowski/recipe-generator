/**
 * Unit helpers. Weight is stored in kilograms and height in centimetres —
 * metric is the canonical form because the Mifflin-St Jeor equation is defined
 * in metric — but the UI shows both systems side by side everywhere.
 */

const LB_PER_KG = 2.2046226218;
const IN_PER_CM = 0.3937007874;

export const kgToLb = (kg: number): number => kg * LB_PER_KG;
export const lbToKg = (lb: number): number => lb / LB_PER_KG;
export const cmToIn = (cm: number): number => cm * IN_PER_CM;
export const inToCm = (inches: number): number => inches / IN_PER_CM;

/** `70.0 kg / 154.3 lb` — the standard weight rendering across the app. */
export function formatWeight(kg: number, fractionDigits = 1): string {
  return `${kg.toFixed(fractionDigits)} kg / ${kgToLb(kg).toFixed(fractionDigits)} lb`;
}

/** `170.0 cm / 5'7"` — centimetres plus feet-and-inches. */
export function formatHeight(cm: number): string {
  const totalInches = cmToIn(cm);
  const feet = Math.floor(totalInches / 12);
  const inches = Math.round(totalInches - feet * 12);
  // Guard the 11.6" → 12" rollover so we never render 5'12".
  const [ft, inch] = inches === 12 ? [feet + 1, 0] : [feet, inches];
  return `${cm.toFixed(1)} cm / ${ft}'${inch}"`;
}

/** Round to the nearest multiple of `step`. */
export function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}

/** Round *up* to the nearest multiple of `step`. */
export function ceilTo(value: number, step: number): number {
  return Math.ceil(value / step) * step;
}
