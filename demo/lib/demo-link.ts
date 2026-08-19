import { TRPCClientError, type TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import type { AppRouter } from "~/server/trpc/root";
import { announce } from "~/components/atoms";
import fixtures from "../fixtures.json";

/**
 * The demo's entire backend: a terminating tRPC link over an in-memory copy
 * of recorded fixture data.
 *
 * Sitting at the link layer — below the typed proxy, above the wire — means
 * every production page runs unmodified: identical query keys, identical
 * hooks, identical components. Queries read from the dataset; the handful of
 * mutations the demo supports update it, so ticking a grocery line or
 * assigning a recipe genuinely works and simply resets on reload. Everything
 * else fails softly with an announcement rather than pretending to save.
 *
 * The fixtures are recorded from a freshly seeded database by
 * `scripts/record-demo-fixtures.mjs` — synthetic by construction. The
 * previous demo attempt leaked a real profile precisely because its data
 * came from a live environment; this one's data provably cannot, because
 * the recorder builds its own database from the committed seed.
 */

type Json = Record<string, unknown>;

/** Deep-cloned per session so mutations never touch the module constant. */
const data: Record<string, unknown> = structuredClone(fixtures);

const q = (path: string): unknown => {
  if (!(path in data)) {
    console.warn(`[demo] no fixture for query ${path}`);
    return null;
  }
  return data[path];
};

/** The mutations the demo actually performs, against the in-memory dataset. */
const mutations: Record<string, (input: Json) => unknown> = {
  "grocery.setChecked": (input) => {
    const list = data["grocery.list"] as {
      sections: { lines: { key: string; checked: boolean }[] }[];
      buyLater: { key: string; checked: boolean }[];
    };
    for (const line of [
      ...list.sections.flatMap((s) => s.lines),
      ...list.buyLater,
    ]) {
      if (line.key === input.key) line.checked = Boolean(input.checked);
    }
    return { ok: true };
  },
  "grocery.clearChecks": () => {
    const list = data["grocery.list"] as {
      sections: { lines: { checked: boolean }[] }[];
      buyLater: { checked: boolean }[];
    };
    for (const line of [
      ...list.sections.flatMap((s) => s.lines),
      ...list.buyLater,
    ]) {
      line.checked = false;
    }
    announce("List reset — everything unticked");
    return { ok: true };
  },
  "plan.setMealSource": (input) => {
    const today = data["plan.today"] as {
      date: string;
      meals: { meal: string; role: string; guidance: string }[];
    };
    for (const meal of today.meals) {
      if (!input.meal || meal.meal === input.meal) {
        meal.role = String(input.mealSource);
        meal.guidance =
          meal.role === "eat_out"
            ? "Eating out: a restaurant, a party, someone else's table. Nothing to plan, nothing to buy."
            : meal.guidance;
      }
    }
    return { ok: true };
  },
};

export function demoLink(): TRPCLink<AppRouter> {
  return () =>
    ({ op }) =>
      observable((observer) => {
        // A whisper of latency so spinners and pending states demo honestly.
        const timer = setTimeout(
          () => {
            if (op.type === "query") {
              observer.next({ result: { data: q(op.path), type: "data" } });
              observer.complete();
              return;
            }

            const handler = mutations[op.path];
            if (handler) {
              observer.next({
                result: {
                  data: handler((op.input ?? {}) as Json),
                  type: "data",
                },
              });
              observer.complete();
              return;
            }

            announce("Just a demo — that action doesn't save anything.");
            observer.error(
              TRPCClientError.from(
                new Error("This is a demo — nothing is saved."),
              ),
            );
          },
          op.type === "query" ? 120 : 250,
        );
        return () => clearTimeout(timer);
      });
}
