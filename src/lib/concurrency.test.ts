import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "./concurrency";

/**
 * The cap is the whole point, so it is what gets tested. A version that
 * silently ignores the limit passes every "did it return the right answers"
 * check and then takes down the eval suite with rate limits.
 */

/** Resolves on the next macrotask, letting other runners make progress. */
const tick = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

/** Runs the worker while recording how many were ever in flight at once. */
function trackingWorker(work: (i: number) => Promise<void> = () => tick()) {
  const state = { inFlight: 0, peak: 0, order: [] as number[] };
  const worker = async (item: number, index: number) => {
    state.inFlight += 1;
    state.peak = Math.max(state.peak, state.inFlight);
    state.order.push(index);
    await work(index);
    state.inFlight -= 1;
    return item * 2;
  };
  return { state, worker };
}

describe("mapWithConcurrency", () => {
  it("never exceeds the limit", async () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    const { state, worker } = trackingWorker();

    await mapWithConcurrency(items, 3, worker);

    expect(state.peak).toBe(3);
  });

  it("actually runs in parallel rather than one at a time", async () => {
    const items = Array.from({ length: 6 }, (_, i) => i);
    const { state, worker } = trackingWorker();

    await mapWithConcurrency(items, 4, worker);

    // A sequential implementation returns the right answers with a peak of 1,
    // which is the failure this guards against.
    expect(state.peak).toBeGreaterThan(1);
  });

  it("returns results in input order, not completion order", async () => {
    const items = [0, 1, 2, 3];
    // Item 0 is the slowest, so completion order is the reverse of input.
    const delays = [40, 30, 20, 10];
    const results = await mapWithConcurrency(items, 4, async (item) => {
      await new Promise((r) => setTimeout(r, delays[item]));
      return item * 10;
    });

    expect(results).toEqual([0, 10, 20, 30]);
  });

  it("keeps every runner busy when one item is slow", async () => {
    // With pre-sliced chunks the slow first item would idle its chunk-mates.
    const items = Array.from({ length: 8 }, (_, i) => i);
    const { state, worker } = trackingWorker((i) =>
      i === 0 ? new Promise<void>((r) => setTimeout(r, 50)) : tick(),
    );

    await mapWithConcurrency(items, 2, worker);

    // All eight started even though the first held a slot the whole time.
    expect(state.order).toHaveLength(8);
  });

  it("handles an empty list without spawning runners", async () => {
    expect(await mapWithConcurrency([], 5, async () => 1)).toEqual([]);
  });

  it("caps runners at the item count for a short list", async () => {
    const { state, worker } = trackingWorker();
    await mapWithConcurrency([1, 2], 10, worker);
    expect(state.peak).toBeLessThanOrEqual(2);
  });

  it("rejects a limit below one rather than hanging", async () => {
    await expect(mapWithConcurrency([1], 0, async () => 1)).rejects.toThrow(
      RangeError,
    );
  });

  it("propagates a worker rejection", async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (item) => {
        if (item === 2) throw new Error("boom");
        return item;
      }),
    ).rejects.toThrow("boom");
  });
});
