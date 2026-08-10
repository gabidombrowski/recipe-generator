import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";
import { auth } from "~/server/auth";
import { loggerFor } from "~/server/logger";

/**
 * tRPC setup.
 *
 * superjson is the transformer so `Date` and `undefined` survive the wire
 * without every procedure hand-rolling serialisation.
 */

const log = loggerFor("trpc");

export async function createTRPCContext(opts: { headers: Headers }) {
  const session = await auth();

  return { session, headers: opts.headers };
}

export type Context = Awaited<ReturnType<typeof createTRPCContext>>;

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        // Surface zod issues in a shape the client can render per-field.
        zodError:
          error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

export const createCallerFactory = t.createCallerFactory;
export const router = t.router;

/** Logs slow procedures. Cheap, and the only tracing this layer needs. */
const timing = t.middleware(async ({ path, type, next }) => {
  const start = Date.now();
  const result = await next();
  const durationMs = Date.now() - start;
  if (durationMs > 500) {
    log.warn({ path, type, durationMs }, "slow procedure");
  }
  return result;
});

/**
 * Unauthenticated. Only used for things the middleware also lets through, and
 * deliberately rare — the middleware gates routes, this gates calls, and the
 * default for both is closed.
 */
export const publicProcedure = t.procedure.use(timing);

/**
 * The default for everything in this app. Even though the middleware already
 * rejects unauthenticated requests to `/api/trpc`, the check is repeated here
 * so a procedure invoked server-side or from a future non-HTTP caller cannot
 * bypass it.
 */
export const protectedProcedure = t.procedure.use(timing).use(({ ctx, next }) => {
  // Keyed on the account id, not the email. GitHub discloses no address for an
  // account with a private one, so an email check here would reject a
  // perfectly valid session — see the allowlist note in `auth.ts`.
  if (!ctx.session?.user?.id) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign-in required." });
  }
  return next({ ctx: { ...ctx, session: ctx.session } });
});
