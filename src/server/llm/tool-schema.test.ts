import { describe, expect, it } from "vitest";
import { GRADE_TOOL } from "../../../evals/judge";
import { EXTRACT_TOOL } from "./extractor";
import { RECIPE_TOOL } from "./generator";
import { PLANNER_TOOLS } from "./planner";

/**
 * Pins the exact JSON Schema each LLM tool hands to the model.
 *
 * These schemas are model-facing contract: the schema eval gate holds
 * generation to 100% conformance against what is emitted here, so an
 * innocent-looking library upgrade that reshapes the output (a zod major, a
 * converter swap) would silently change what the model is asked to produce.
 * A snapshot makes that change loud: if one of these fails, the diff *is*
 * the change the model would see — read it and decide, never just update.
 */
describe("LLM tool input schemas", () => {
  it("recipe generator tool", () => {
    expect(RECIPE_TOOL.input_schema).toMatchSnapshot();
  });

  it("constraint extractor tool", () => {
    expect(EXTRACT_TOOL.input_schema).toMatchSnapshot();
  });

  it("planner tools", () => {
    expect(
      PLANNER_TOOLS.map((t) => ({ name: t.name, input_schema: t.input_schema })),
    ).toMatchSnapshot();
  });

  it("eval judge tool", () => {
    expect(GRADE_TOOL.input_schema).toMatchSnapshot();
  });
});
