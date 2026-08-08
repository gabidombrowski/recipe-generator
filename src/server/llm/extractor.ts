import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { type Anthropic as AnthropicNS } from "@anthropic-ai/sdk";
import { getClient, isRetryable, MAX_TOKENS, MODELS } from "./client";
import { loadPrompt, PROMPT_NAMES, renderPrompt } from "./prompts";
import { loggerFor } from "~/server/logger";
import { recordGeneration, withSpan, type TokenUsage } from "~/server/telemetry";
import { validateGuidelineNote } from "~/lib/guidelines";
import { constraintSchema, type Constraint, type IngredientTag } from "~/lib/constraints";

/**
 * The setup interview: prose in, proposed constraints out.
 *
 * The model is used as a **parser, not an author**. It never writes prompt text
 * and never writes to the database — it returns proposals that a person accepts
 * or rejects one at a time, and only the accepted ones become config.
 *
 * That distinction is the whole design. If setup produced a personalised system
 * prompt instead, there would be nothing for `verifyWeek` to count and nothing
 * for the Tier 1 eval gates to assert, and `promptHash` would stop identifying
 * the prompt CI actually tested. Parsing into structured rules keeps every one
 * of those guarantees.
 *
 * Two independent checks apply to whatever comes back, because a proposal is
 * still model output derived from untrusted text:
 *
 *   1. every constraint is re-validated against `constraintSchema`
 *   2. every `note` goes through `validateGuidelineNote`, the same filter that
 *      guards hand-typed notes — so an injection that survives the prompt still
 *      cannot reach the generator through this path
 */

const log = loggerFor("extractor");

export const EXTRACT_TOOL_NAME = "propose_constraints";

const proposalSchema = z.object({
  constraint: constraintSchema,
  because: z
    .string()
    .min(1)
    .max(200)
    .describe("The words of theirs that imply this rule. Shown to them for approval."),
});

const proposalsSchema = z.object({
  proposals: z.array(proposalSchema).max(20),
});

const EXTRACT_TOOL: AnthropicNS.Tool = {
  name: EXTRACT_TOOL_NAME,
  description:
    "Return the dietary rules implied by their description. Every entry is a proposal for a person to approve; nothing is applied automatically.",
  input_schema: (() => {
    const schema = zodToJsonSchema(proposalsSchema, {
      $refStrategy: "none",
      target: "jsonSchema7",
    }) as Record<string, unknown>;
    delete schema.$schema;
    return schema as AnthropicNS.Tool["input_schema"];
  })(),
};

export interface Proposal {
  constraint: Constraint;
  because: string;
}

export interface ExtractionResult {
  proposals: Proposal[];
  /** Proposals dropped by the post-checks, with the reason. Surfaced, not hidden. */
  rejected: Array<{ because: string; reasons: string[] }>;
  promptHash: string;
  modelString: string;
  costUsd: number;
}

function describeVocabulary(tags: readonly IngredientTag[]): string {
  if (tags.length === 0) {
    return "No tags are defined yet, so do not propose any `tag_cap` rules. Use `exclude_ingredient` or `note` instead.";
  }
  return tags.map((t) => `- \`${t.name}\``).join("\n");
}

/**
 * Re-validates a proposal after the model returns it.
 *
 * The schema check is not redundant with the tool schema: a forced tool call
 * constrains the shape, not the semantics, and notes in particular need the
 * same injection filter a hand-typed note gets.
 */
function checkProposal(
  raw: unknown,
  vocabulary: readonly IngredientTag[],
): { ok: true; proposal: Proposal } | { ok: false; because: string; reasons: string[] } {
  const parsed = proposalSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      because: typeof (raw as { because?: string })?.because === "string" ? (raw as { because: string }).because : "(unparseable)",
      reasons: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    };
  }

  const { constraint, because } = parsed.data;

  if (constraint.kind === "note") {
    const checked = validateGuidelineNote(constraint.text);
    if (!checked.ok) return { ok: false, because, reasons: checked.reasons };
    return { ok: true, proposal: { constraint: { kind: "note", text: checked.value }, because } };
  }

  // A cap on a tag that does not exist would silently never match.
  if (constraint.kind === "tag_cap") {
    const known = vocabulary.some(
      (t) => t.name.toLowerCase() === constraint.tag.trim().toLowerCase(),
    );
    if (!known) {
      return {
        ok: false,
        because,
        reasons: [`no ingredient tag named "${constraint.tag}" exists yet`],
      };
    }
    if (constraint.maxPerRecipe === null && constraint.maxPerWeek === null) {
      return { ok: false, because, reasons: ["a tag limit needs a per-recipe or per-week cap"] };
    }
  }

  return { ok: true, proposal: { constraint, because } };
}

export async function extractConstraints(
  description: string,
  vocabulary: readonly IngredientTag[],
): Promise<ExtractionResult> {
  return withSpan("llm.extract_constraints", async () => {
    const client = getClient();
    const prompt = loadPrompt(PROMPT_NAMES.constraintExtractor);
    const system = renderPrompt(prompt, {
      TAG_VOCABULARY: describeVocabulary(vocabulary),
    });

    const startedAt = Date.now();
    const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };

    let message: AnthropicNS.Message;
    try {
      message = await client.messages.create({
        model: MODELS.generation,
        max_tokens: MAX_TOKENS,
        system,
        tools: [EXTRACT_TOOL],
        tool_choice: { type: "tool", name: EXTRACT_TOOL_NAME },
        messages: [
          {
            role: "user",
            // Delimited and labelled as data, matching the system prompt's
            // framing. The post-checks are what actually enforce it.
            content: `Here is how they described their needs.\n\n<description>\n${description}\n</description>`,
          },
        ],
      });
    } catch (error) {
      recordGeneration({
        model: MODELS.generation,
        operation: "extractor",
        usage,
        latencyMs: Date.now() - startedAt,
        retries: 0,
        status: isRetryable(error) ? "error" : "error",
      });
      throw error;
    }

    usage.inputTokens += message.usage.input_tokens;
    usage.outputTokens += message.usage.output_tokens;

    const toolUse = message.content.find(
      (block): block is AnthropicNS.ToolUseBlock =>
        block.type === "tool_use" && block.name === EXTRACT_TOOL_NAME,
    );

    const raw = toolUse
      ? ((toolUse.input as { proposals?: unknown[] }).proposals ?? [])
      : [];

    const proposals: Proposal[] = [];
    const rejected: ExtractionResult["rejected"] = [];

    for (const entry of raw) {
      const checked = checkProposal(entry, vocabulary);
      if (checked.ok) proposals.push(checked.proposal);
      else rejected.push({ because: checked.because, reasons: checked.reasons });
    }

    const costUsd = recordGeneration({
      model: MODELS.generation,
      operation: "extractor",
      usage,
      latencyMs: Date.now() - startedAt,
      retries: 0,
      status: toolUse ? "success" : "invalid",
    });

    log.info(
      { proposed: proposals.length, rejected: rejected.length },
      "constraint extraction complete",
    );

    return {
      proposals,
      rejected,
      promptHash: prompt.hash,
      modelString: MODELS.generation,
      costUsd,
    };
  });
}

/** Exported for hermetic tests of the post-checks. */
export const __testing = { checkProposal };
