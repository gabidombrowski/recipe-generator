import { type Anthropic as AnthropicNS } from "@anthropic-ai/sdk";
import { z } from "zod";

/**
 * The JSON Schema handed to the model for a tool, via zod 4's native
 * converter (which retired the zod-to-json-schema dependency). Reused
 * definitions are inlined rather than `$ref`-linked, because a schema full
 * of pointers is harder for a model to follow than one that repeats itself.
 *
 * `io: "input"` because a tool schema describes what the model must
 * *produce* — transforms like the judge's note-truncation apply after.
 * The override restores `additionalProperties: false` on every object:
 * zod 4 stopped emitting it for plain objects, but "no invented keys" has
 * been part of this contract since the first eval baseline.
 *
 * Every LLM tool in the app converts through here, and `tool-schema.test.ts`
 * snapshots each tool's output: the emitted schema is model-facing contract
 * measured by the eval gates, so a change here has to fail a test and show
 * its diff instead of shipping silently.
 */
export function toToolInputSchema(
  schema: z.ZodType,
): AnthropicNS.Tool["input_schema"] {
  const json = z.toJSONSchema(schema, {
    target: "draft-7",
    io: "input",
    reused: "inline",
    override: (ctx) => {
      const js = ctx.jsonSchema;
      if (js.type === "object") {
        js.additionalProperties ??= false;
      }
      // zod 4 stamps `.int()` with ±MAX_SAFE_INTEGER bounds — validator
      // noise in a schema a model reads. Strip exactly those sentinels;
      // real `.min()`/`.max()` bounds carry other values and stay.
      if (js.type === "integer") {
        if (js.minimum === -9007199254740991) delete js.minimum;
        if (js.maximum === 9007199254740991) delete js.maximum;
      }
    },
  }) as Record<string, unknown>;

  // The API rejects the meta-schema key.
  delete json.$schema;
  return json as AnthropicNS.Tool["input_schema"];
}
