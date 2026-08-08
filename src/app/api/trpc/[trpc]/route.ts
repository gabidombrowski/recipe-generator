import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { createTRPCContext } from "~/server/trpc/init";
import { appRouter } from "~/server/trpc/root";
import { loggerFor } from "~/server/logger";

const log = loggerFor("trpc-http");

function handler(request: Request) {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: request,
    router: appRouter,
    createContext: () => createTRPCContext({ headers: request.headers }),
    onError({ path, error }) {
      // UNAUTHORIZED is the middleware doing its job, not an incident.
      if (error.code === "UNAUTHORIZED") return;
      log.error({ path, code: error.code, err: error.cause ?? error }, "procedure failed");
    },
  });
}

export { handler as GET, handler as POST };
