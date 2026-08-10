/**
 * Bounded parallelism.
 *
 * The interesting parameter is the cap, not the parallelism. Every concurrent
 * path in this app ends at one rate-limited API, so an unbounded `Promise.all`
 * over ninety eval fixtures would not be fast — it would be ninety
 * simultaneous requests, a wall of 429s, and a suite that fails for a reason
 * unrelated to what it was testing.
 *
 * Deliberately not a dependency. The whole idea is a counter and a queue, and
 * a reader can check this is correct in less time than it takes to audit a
 * package.
 */

/**
 * Runs `worker` over every item, with at most `limit` in flight at once.
 *
 * Results come back in input order regardless of completion order, so callers
 * can zip them against their inputs.
 *
 * Rejections are *not* swallowed: a failing item rejects the whole call, the
 * same as `Promise.all`. Callers that want per-item isolation should have the
 * worker return its own result-or-error, which is what the eval runner does —
 * it already catches per fixture so one bad fixture cannot end the suite.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (limit < 1) throw new RangeError(`limit must be >= 1, got ${limit}`);
  if (items.length === 0) return [];

  const results = new Array<R>(items.length);
  let next = 0;

  /**
   * Each runner pulls the next index and keeps going until the list is
   * exhausted. A shared cursor rather than pre-sliced chunks, so one slow item
   * cannot leave its whole chunk idle behind it while other runners finish.
   */
  async function runner(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]!, index);
    }
  }

  const runners = Array.from({ length: Math.min(limit, items.length) }, () =>
    runner(),
  );
  await Promise.all(runners);
  return results;
}
