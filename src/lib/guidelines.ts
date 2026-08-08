import { z } from "zod";

/**
 * Dietary guidelines: user-entered rules about what to cook.
 *
 * Everything the app knows about a person's dietary needs is entered here at
 * runtime and stored in the (gitignored) database. The committed code ships no
 * guidelines at all and names no condition — it only knows how to *apply* rules
 * it is given. That is deliberate: publishing the engine should not publish the
 * medical reason someone needed it.
 *
 * A guideline can do three things, alone or together:
 *
 *   - cap how many ingredients carrying a culinary tag may appear in one recipe
 *   - cap how many cook recipes per week may contain that tag
 *   - carry a free-text note that is shown to the recipe generator
 *
 * The free text is the sensitive part: it reaches an LLM prompt, so it is
 * validated on the way in rather than trusted. See `validateGuidelineNote`.
 */

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

export const MAX_NOTE_LENGTH = 200;
export const MAX_TAG_LENGTH = 32;

export const guidelineSchema = z.object({
  id: z.number().int().positive(),
  /** Culinary tag this applies to, e.g. `fermented`. Null for a note-only rule. */
  tag: z.string().max(MAX_TAG_LENGTH).nullable(),
  /** At most N ingredients carrying `tag` in a single recipe. */
  maxPerRecipe: z.number().int().min(0).max(20).nullable(),
  /** At most N cook recipes containing `tag` across one week. */
  maxCookPerWeek: z.number().int().min(0).max(7).nullable(),
  /** Free text passed to the generator, e.g. "prefer coconut aminos to soy". */
  note: z.string().max(MAX_NOTE_LENGTH),
  active: z.boolean(),
  createdAt: z.string(),
});
export type DietaryGuideline = z.infer<typeof guidelineSchema>;

/** A guideline is useless unless it constrains something. */
export function isMeaningful(
  g: Pick<DietaryGuideline, "tag" | "maxPerRecipe" | "maxCookPerWeek" | "note">,
): boolean {
  const hasLimit =
    g.tag !== null && (g.maxPerRecipe !== null || g.maxCookPerWeek !== null);
  return hasLimit || g.note.trim().length > 0;
}

// ---------------------------------------------------------------------------
// Input filtering
// ---------------------------------------------------------------------------

export type GuidelineCheck =
  | { ok: true; value: string }
  | { ok: false; reasons: string[] };

/**
 * Text that is trying to address the model rather than describe food.
 *
 * This list is the reason the free-text field is safe to interpolate into a
 * system prompt at all. The prompt also tells the model to treat this content
 * as data — but "the model was told to ignore it" is a mitigation, not a
 * control. Rejecting it at the boundary is the control.
 */
const INSTRUCTION_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/\b(ignore|disregard|forget|override|bypass)\b.{0,30}\b(previous|prior|above|earlier|all|your|the)\b/i,
    "looks like an attempt to override instructions"],
  [/\b(system|assistant|user)\s*[:>]/i, "contains a chat-role marker"],
  [/\byou (are|must|should|will|shall)\b/i, "addresses the assistant rather than describing food"],
  [/\b(your )?(instructions?|system prompt|prompt|guidelines given)\b/i, "refers to the assistant's instructions"],
  [/\b(reply|respond|answer|output|print|return|write)\b.{0,20}\b(with|only|instead|as)\b/i,
    "tries to control the response format"],
  [/\b(tool|function)[\s_-]?(call|use)\b|save_recipe|propose_week/i, "refers to tool calling"],
  [/\b(api[\s_-]?key|token|secret|password|credential)\b/i, "refers to credentials"],
  [/\b(reveal|disclose|repeat|show me)\b.{0,25}\b(prompt|instruction|rule|system)\b/i,
    "asks the assistant to disclose its instructions"],
  [/\bregardless of\b|\bno matter what\b|\bin all cases\b/i, "uses override phrasing"],
];

/** Markup and encodings that have no place in a one-line dietary rule. */
const MARKUP_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/```|~~~/, "contains a code fence"],
  [/<!--|-->/, "contains an HTML comment"],
  [/<\/?[a-z][^>]*>/i, "contains an HTML tag"],
  [/\{\{|\}\}|\$\{/, "contains a template placeholder"],
  [/https?:\/\/|www\./i, "contains a URL"],
  [/[^\s@]+@[^\s@]+\.[^\s@]+/, "contains an email address"],
  // Escapes, not literal characters: literal control bytes do not survive
  // copy-paste, editor normalisation, or a careless reformat.
  [/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/, "contains control characters"],
  // Zero-width and bidi marks are a classic way to smuggle hidden text past a
  // human reviewer while the model still reads it.
  [/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/, "contains invisible characters"],
];

/**
 * Words that make a sentence a *constraint* rather than a statement.
 *
 * Requiring one is how "not related to recipe qualifications" gets filtered:
 * a dietary guideline says to avoid, limit, prefer or swap something. Prose
 * that expresses no constraint is not a guideline, whatever it is about.
 */
const CONSTRAINT_MARKERS = new RegExp(
  "\\b(" +
    [
      // Negation. `nothing` and `none` need listing separately — `\bno\b`
      // does not match them, which rejected "nothing fermented on cook days".
      "avoid(s|ed)?", "no", "nothing", "none", "not", "never", "without",
      "free", "skip", "omit", "exclude", "drop", "cut", "can.?t", "don.?t",
      // Bounds.
      "limit(ed)?", "max(imum)?", "min(imum)?", "at most", "at least",
      "only", "under", "over", "fewer", "less", "more", "extra", "high", "low",
      // Substitution and preference.
      "prefer(s|red)?", "rather", "instead", "swap", "substitute", "replace",
      "use", "reduce", "keep", "stick",
      // Explicit dietary framing.
      "allerg\\w*", "intoler\\w*", "sensitiv\\w*", "gentle", "easy on",
    ].join("|") +
    ")\\b",
  "i",
);

/**
 * Validates a free-text guideline.
 *
 * Order matters: structural checks first (cheap, unambiguous), then
 * instruction-injection checks, then the "is this actually a constraint" test.
 * All failing reasons are collected so the UI can explain rather than just
 * refuse.
 */
export function validateGuidelineNote(raw: string): GuidelineCheck {
  const reasons: string[] = [];

  if (/[\r\n]/.test(raw)) {
    reasons.push("must be a single line — enter one rule at a time");
  }

  // Collapse runs of whitespace so length limits mean what they look like.
  const value = raw.replace(/\s+/g, " ").trim();

  if (value.length === 0) {
    return { ok: false, reasons: ["cannot be empty"] };
  }
  if (value.length < 3) {
    reasons.push("too short to be a rule");
  }
  if (value.length > MAX_NOTE_LENGTH) {
    reasons.push(`must be ${MAX_NOTE_LENGTH} characters or fewer (currently ${value.length})`);
  }

  for (const [pattern, reason] of MARKUP_PATTERNS) {
    if (pattern.test(value)) reasons.push(reason);
  }
  for (const [pattern, reason] of INSTRUCTION_PATTERNS) {
    if (pattern.test(value)) reasons.push(reason);
  }

  if (!CONSTRAINT_MARKERS.test(value)) {
    reasons.push(
      "does not read as a dietary rule — say what to avoid, limit, prefer or swap",
    );
  }

  return reasons.length === 0
    ? { ok: true, value }
    : { ok: false, reasons: [...new Set(reasons)] };
}

/**
 * Validates a culinary tag.
 *
 * Tags are matched against ingredient tags, so they are deliberately narrow:
 * lowercase words and hyphens, nothing that could carry markup or an
 * instruction.
 */
export function validateGuidelineTag(raw: string): GuidelineCheck {
  const value = raw.trim().toLowerCase().replace(/\s+/g, " ");
  const reasons: string[] = [];

  if (value.length === 0) return { ok: false, reasons: ["cannot be empty"] };
  if (value.length < 2) reasons.push("too short");
  if (value.length > MAX_TAG_LENGTH) {
    reasons.push(`must be ${MAX_TAG_LENGTH} characters or fewer`);
  }
  if (!/^[a-z][a-z -]*[a-z]$/.test(value)) {
    reasons.push("use lowercase letters, spaces and hyphens only");
  }

  return reasons.length === 0 ? { ok: true, value } : { ok: false, reasons };
}

// ---------------------------------------------------------------------------
// Applying guidelines
// ---------------------------------------------------------------------------

/** Counts, per tag, how many ingredients carry it. Derived, never user-set. */
export function countTags(
  ingredients: ReadonlyArray<{ tags: readonly string[] }>,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const ingredient of ingredients) {
    for (const raw of ingredient.tags) {
      const tag = raw.trim().toLowerCase();
      if (tag) counts[tag] = (counts[tag] ?? 0) + 1;
    }
  }
  return counts;
}

/** How many ingredients in this recipe carry `tag`. */
export function tagCount(
  tagCounts: Record<string, number>,
  tag: string,
): number {
  return tagCounts[tag.trim().toLowerCase()] ?? 0;
}

/** Guidelines that cap tagged ingredients within one recipe. */
export function perRecipeViolations(
  tagCounts: Record<string, number>,
  guidelines: readonly DietaryGuideline[],
): string[] {
  return guidelines
    .filter((g) => g.active && g.tag !== null && g.maxPerRecipe !== null)
    .flatMap((g) => {
      const count = tagCount(tagCounts, g.tag!);
      return count > g.maxPerRecipe!
        ? [`${count} "${g.tag}" ingredients; at most ${g.maxPerRecipe} allowed`]
        : [];
    });
}

/** Renders the active guidelines as prompt text for the generator. */
export function describeGuidelines(guidelines: readonly DietaryGuideline[]): string {
  const active = guidelines.filter((g) => g.active);
  if (active.length === 0) return "No additional dietary rules are configured.";

  return active
    .map((g) => {
      const parts: string[] = [];
      if (g.tag && g.maxPerRecipe !== null) {
        parts.push(
          `Use at most ${g.maxPerRecipe} ingredient${g.maxPerRecipe === 1 ? "" : "s"} tagged "${g.tag}" in this recipe, and tag any you use.`,
        );
      }
      if (g.note) parts.push(g.note);
      return `- ${parts.join(" ")}`;
    })
    .join("\n");
}
