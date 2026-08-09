# Structured generation

The Recipe schema is defined **once**, in `src/lib/schemas.ts`. That single
definition is:

- the Drizzle column types
- the tRPC input and output schemas
- the React prop types
- converted via `zod-to-json-schema` into the tool definition handed to Claude
- what the eval assertions validate against

Generation uses a **forced tool call** (`tool_choice: { type: "tool", name:
"save_recipe" }`), so the model has no output path that isn't the schema. Output
is read from the tool-use block and re-validated with the same zod schema; on a
validation failure the specific issues are fed back and it retries, because the
model usually needs to fix one field rather than rewrite the dish. There is a
defensive prose-parsing fallback for the case where the tool block is absent
entirely, and it logs loudly if it ever fires.

Derived fields — `tagCounts`, the ingredient search blob — are computed
on write in `src/server/db/recipes.ts` and never accepted from a caller. A client
could get them wrong; a model could get them wrong on purpose.

**Prompts are code.** They live in `/prompts` as versioned files, are hashed
(SHA-256, first 16 hex), and every generated recipe records the prompt hash and
the model string. Both appear in eval reports. A prompt change that skips the
evals is visible as a hash nobody has a passing run for.

---
