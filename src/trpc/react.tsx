"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { createTRPCContext } from "@trpc/tanstack-react-query";
import superjson from "superjson";
import type { AppRouter } from "~/server/trpc/root";

/**
 * Client-side tRPC, wired through TanStack Query.
 *
 * `useTRPC()` returns a typed proxy: `trpc.plan.today.queryOptions(input)`
 * produces the options object for `useQuery`, so query keys and input types
 * come from the router definition rather than from hand-written strings.
 */
export const { TRPCProvider, useTRPC } = createTRPCContext<AppRouter>();

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // This is a single-user app on a local database; data is effectively
        // never stale from another actor, and refetching on every window focus
        // is noise.
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  });
}

export function TRPCReactProvider({ children }: { children: ReactNode }) {
  // Created in state so React's strict-mode double-render doesn't discard the
  // cache on every mount.
  const [queryClient] = useState(makeQueryClient);
  const [trpcClient] = useState(() =>
    createTRPCClient<AppRouter>({
      links: [httpBatchLink({ url: "/api/trpc", transformer: superjson })],
    }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        {children}
      </TRPCProvider>
    </QueryClientProvider>
  );
}
