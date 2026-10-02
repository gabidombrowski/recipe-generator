import { auth } from "~/server/auth";
import { generateInputSchema } from "~/server/trpc/routers/generation";
import { generateRecipe, GenerationError } from "~/server/llm/generator";
import { isAborted, isLlmConfigured } from "~/server/llm/client";
import { excludedLower, listRecipes } from "~/server/db/queries";
import { getProfile } from "~/server/db/state";
import { getDietaryConfig } from "~/server/db/config";
import { insertRecipe } from "~/server/db/recipes";
import {
  embedQuery,
  similarFavorites,
  upsertRecipeEmbedding,
} from "~/server/embeddings";
import { similarContext } from "~/server/embeddings/context";
import { RATE_LIMITS, rateLimit } from "~/server/rate-limit";
import { encodeSse, type SseEvent } from "~/lib/sse";
import { loggerFor } from "~/server/logger";

const log = loggerFor("generate-stream");

export const dynamic = "force-dynamic";

/**
 * The generate tab's transport: the same generation the tRPC mutation runs,
 * streamed as server-sent events so the recipe is visible as it is written
 * instead of after a silent half minute.
 *
 * Why a route handler beside tRPC rather than tRPC subscriptions: this is the
 * app's one streaming surface, and a plain HTTP response body of SSE frames is
 * the whole implementation — no subscription transport, no client runtime,
 * curl can debug it. If a second streaming feature ever appears, that calculus
 * changes and this comment is the reminder to revisit.
 *
 * Events: `attempt {n}` (a retry is visible, not silent), `delta {text}` (raw
 * partial JSON of the forced tool call), `done {recipe, costUsd, attempts}`,
 * `error {message}`.
 *
 * Deliberately no auto-reconnect story: a generation is not idempotent — a
 * reconnect would be a second bill, not a resumed first one. The client
 * treats a dropped stream as a failed attempt and lets the user retry.
 *
 * The week page's per-slot generation stays on the tRPC mutation: it wants
 * the assign-to-slot semantics, not the streaming.
 */
export async function POST(request: Request): Promise<Response> {
  // Same two checks as `protectedProcedure`, in the same order, because this
  // route sits beside tRPC rather than behind it. Middleware already gates
  // /api/*; this is the defence-in-depth copy of the call-level check.
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return Response.json({ error: "Sign-in required." }, { status: 401 });
  }

  if (!isLlmConfigured()) {
    return Response.json(
      {
        error: "ANTHROPIC_API_KEY is not set, so AI generation is unavailable.",
      },
      { status: 412 },
    );
  }

  const limit = rateLimit(`generate:${userId}`, RATE_LIMITS.generation);
  if (!limit.ok) {
    return Response.json(
      {
        error: `Generation limit reached. Try again in ${limit.retryAfterSeconds}s.`,
      },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      },
    );
  }

  const body = generateInputSchema
    .omit({ targetDate: true, targetMeal: true })
    .safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  const input = body.data;

  const profile = getProfile();
  const favorites = listRecipes().filter((r) => r.favorite);
  const query = [input.cuisine, input.mealType, input.note]
    .filter(Boolean)
    .join(" ");
  const queryVector = await embedQuery(query);
  const [exemplars, contextNotes] = await Promise.all([
    similarFavorites(query, favorites, 3, queryVector),
    similarContext(query, 3, queryVector),
  ]);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: SseEvent) =>
        controller.enqueue(encoder.encode(encodeSse(event)));

      try {
        const result = await generateRecipe(
          input,
          {
            profile,
            // The generate tab is not tied to a date, so the more demanding
            // training-day targets are the safer sizing — same choice as the
            // library fill, for the same reason.
            trainingDay: true,
            excluded: excludedLower(),
            config: getDietaryConfig(),
            exemplars,
            contextNotes,
          },
          {
            // `request.signal` aborts when the client disconnects — closing
            // the tab stops the model call instead of billing to completion.
            signal: request.signal,
            onAttempt: (n) => send({ event: "attempt", data: { n } }),
            onDelta: (text) => send({ event: "delta", data: { text } }),
          },
        );

        const recipe = insertRecipe(result.recipe, {
          source: "ai",
          promptHash: result.promptHash,
          modelString: result.modelString,
        });
        await upsertRecipeEmbedding(recipe);

        send({
          event: "done",
          data: { recipe, costUsd: result.costUsd, attempts: result.attempts },
        });
      } catch (error) {
        if (isAborted(error)) {
          // The client left; there is nobody to tell.
          log.info("generation stream aborted by client");
        } else if (error instanceof GenerationError) {
          send({
            event: "error",
            data: {
              message: `${error.message}${
                error.lastIssues?.length
                  ? `: ${error.lastIssues.join("; ")}`
                  : ""
              }`,
            },
          });
        } else {
          log.error({ err: error }, "generation stream failed");
          send({ event: "error", data: { message: "Generation failed." } });
        }
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed by a client disconnect — nothing to do.
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
