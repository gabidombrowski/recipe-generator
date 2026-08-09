/**
 * Unit helpers. Weight is stored in kilograms and height in centimetres —
 * metric is the canonical form because the Mifflin-St Jeor equation is defined
 * in metric. Which system the UI *asks* in is a per-user setting; the other one
 * is always shown as a hint, so a number entered in the unfamiliar system can
 * still be sanity-checked at a glance.
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

/**
 * Splits centimetres into whole feet and inches.
 *
 * The rollover guard matters: 179.5 cm is 5 ft 11.6 in, and rounding the inches
 * alone renders 5'12". Carrying into the next foot is what keeps the imperial
 * height input from showing a value that does not exist.
 */
export function cmToFeetInches(cm: number): { feet: number; inches: number } {
  const totalInches = cmToIn(cm);
  const feet = Math.floor(totalInches / 12);
  const inches = Math.round(totalInches - feet * 12);
  return inches === 12 ? { feet: feet + 1, inches: 0 } : { feet, inches };
}

export function feetInchesToCm(feet: number, inches: number): number {
  return inToCm(feet * 12 + inches);
}

/** The unit-aware label and hint pair for a weight field. */
export function weightLabel(units: "metric" | "imperial"): string {
  return units === "imperial" ? "Weight (lb)" : "Weight (kg)";
}

/** The *other* system, shown as a hint so the number is always checkable. */
export function weightHint(kg: number, units: "metric" | "imperial"): string {
  return units === "imperial"
    ? `${kg.toFixed(1)} kg`
    : `${kgToLb(kg).toFixed(1)} lb`;
}

export function heightHint(cm: number, units: "metric" | "imperial"): string {
  if (units === "imperial") return `${cm.toFixed(1)} cm`;
  const { feet, inches } = cmToFeetInches(cm);
  return `${feet}'${inches}"`;
}
