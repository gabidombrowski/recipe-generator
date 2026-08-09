import { describe, expect, it } from "vitest";
import {
  cmToFeetInches,
  feetInchesToCm,
  heightHint,
  kgToLb,
  lbToKg,
  weightHint,
  weightLabel,
} from "./units";

/**
 * Units are a display concern; storage is always metric. These cover the two
 * ways that goes wrong: a rounding drift that moves the stored value every time
 * the form re-renders, and the 5'12" rollover.
 */
describe("unit conversion", () => {
  it("round-trips kilograms through pounds without drifting", () => {
    // Entering a weight in pounds and reading it back must land on the same
    // kilogram value, or the number creeps on every keystroke.
    const kg = 70.5;
    const backAgain = Number(lbToKg(Number(kgToLb(kg).toFixed(1))).toFixed(2));
    expect(Math.abs(backAgain - kg)).toBeLessThan(0.05);
  });

  it("never renders twelve inches", () => {
    // 179.5 cm is 5 ft 11.6 in; rounding the inches alone gives 5'12".
    const { feet, inches } = cmToFeetInches(179.5);
    expect(inches).toBeLessThan(12);
    expect(feet).toBe(5);
  });

  it("carries into the next foot when inches round up", () => {
    const { feet, inches } = cmToFeetInches(182.85); // ~5 ft 11.98 in
    expect(feet).toBe(6);
    expect(inches).toBe(0);
  });

  it("round-trips feet and inches through centimetres", () => {
    const cm = feetInchesToCm(5, 8);
    const { feet, inches } = cmToFeetInches(cm);
    expect(feet).toBe(5);
    expect(inches).toBe(8);
  });

  it("labels and hints show the system the user is not entering in", () => {
    expect(weightLabel("imperial")).toBe("Weight (lb)");
    expect(weightLabel("metric")).toBe("Weight (kg)");
    // The hint is the *other* system, so the value stays checkable.
    expect(weightHint(70.5, "imperial")).toContain("kg");
    expect(weightHint(70.5, "metric")).toContain("lb");
    expect(heightHint(170.2, "metric")).toContain("'");
    expect(heightHint(170.2, "imperial")).toContain("cm");
  });
});
