"use client";

import { useEffect, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createTRPCClient } from "@trpc/client";
import type { AppRouter } from "~/server/trpc/root";
import { TRPCProvider } from "~/trpc/react";
import { encodeSse } from "~/lib/sse";
import { demoLink } from "../lib/demo-link";
import fixtures from "../fixtures.json";

/**
 * The demo's providers: the production `TRPCProvider` context — so every page
 * component's `useTRPC()` resolves exactly as in the real app — fed by a
 * client whose only link is the in-memory fixture link. No HTTP exists to
 * fall back to.
 *
 * The query client deliberately omits the production mutation-error banner:
 * the fixture link already announces unsupported actions in demo terms, and
 * stacking "That did not save" on top would say the same thing twice.
 */
export function DemoProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: Infinity, retry: false },
          mutations: { retry: false },
        },
      }),
  );
  const [client] = useState(() =>
    createTRPCClient<AppRouter>({ links: [demoLink()] }),
  );

  // The generate tab streams over fetch('/api/generate/stream'); a static
  // export has no routes, so that URL is intercepted here and answered with a
  // recorded transcript replayed as real SSE frames — same wire format, same
  // parser, ~40 chars per tick. Everything else passes through untouched.
  useEffect(() => {
    const original = window.fetch.bind(window);
    window.fetch = (input, init) => {
      // fetch accepts string | URL | Request. Next's router passes URL
      // objects for RSC payloads; reading `.url` off those is undefined and
      // the throw made every client navigation fall back to a full reload.
      const url = input instanceof Request ? input.url : String(input);
      if (!url.includes("/api/generate/stream")) return original(input, init);

      const { recipe, chunks } = (
        fixtures as unknown as {
          __streamTranscript: { recipe: unknown; chunks: string[] };
        }
      ).__streamTranscript;

      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const send = (event: string, data: unknown) =>
            controller.enqueue(encoder.encode(encodeSse({ event, data })));
          send("attempt", { n: 1 });
          // Drift-corrected pacing rather than a sleep per chunk: hidden
          // tabs clamp timers to one tick per second, and a naive 35ms loop
          // would stretch a seven-second replay to several minutes the
          // moment the tab is backgrounded. Emitting every chunk that is
          // *due* on each wake keeps wall-clock time constant regardless of
          // visibility — the same class of bug the announcer hit with
          // requestAnimationFrame.
          const started = Date.now();
          let emitted = 0;
          while (emitted < chunks.length) {
            if (init?.signal?.aborted) {
              controller.close();
              return;
            }
            const due = Math.min(
              chunks.length,
              Math.floor((Date.now() - started) / 35) + 1,
            );
            while (emitted < due) send("delta", { text: chunks[emitted++] });
            if (emitted < chunks.length) {
              await new Promise((r) => setTimeout(r, 40));
            }
          }
          send("done", { recipe, costUsd: 0, attempts: 1 });
          controller.close();
        },
      });

      return Promise.resolve(
        new Response(stream, {
          headers: { "Content-Type": "text/event-stream" },
        }),
      );
    };
    return () => {
      window.fetch = original;
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={client} queryClient={queryClient}>
        {children}
      </TRPCProvider>
    </QueryClientProvider>
  );
}
