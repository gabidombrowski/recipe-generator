import { type Anthropic as AnthropicNS } from "@anthropic-ai/sdk";
import { type z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

/**
 * The JSON Schema handed to the model for a tool. Inlined rather than
 * `$ref`-linked, because a schema full of pointers is harder for a model to
 * follow than one that repeats itself; the meta-schema key is dropped because
 * the API rejects it.
 *
 * Every LLM tool in the app converts through here, and `tool-schema.test.ts`
 * snapshots each converter's output: the emitted schema is part of the
 * model-facing contract the eval gates measure, so a library change that
 * would reshape it has to fail a test instead of shipping silently.
 */
export function toToolInputSchema(
  schema: z.ZodTypeAny,
): AnthropicNS.Tool["input_schema"] {
  const json = zodToJsonSchema(schema, {
    $refStrategy: "none",
    target: "jsonSchema7",
  }) as Record<string, unknown>;
  delete json.$schema;
  return json as AnthropicNS.Tool["input_schema"];
}
