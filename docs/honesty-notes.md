# Honesty notes

- **This is a single-user app, so the threat model is mostly hypothetical.**
  The red-team eval fixtures and the guideline input validator demonstrate a
  methodology — untrusted text must not become instructions — rather than
  defending against a real adversary. There is one user, and they are not
  attacking themselves. The methodology is the point: it is what you would want
  already in place before this pattern went anywhere multi-tenant, and the
  guideline field is a genuine text-box-to-system-prompt path, which is exactly
  the shape that bites people in real products.
- **The app names no dietary condition, and that is deliberate.** Ingredient
  tags are culinary facts; what to do about them is user data in a gitignored
  database. A meal planner's source can otherwise disclose the medical reason it
  exists, which is a poor trade for publishing the engineering.
- **sqlite-vec at this corpus size is technique demonstration, not necessity.**
  With a few dozen recipes, brute-force cosine over 384-dimensional vectors is
  instant and `LIKE` would answer most queries nearly as well. Measured on the
  seed library, "spicy korean beef" returns Gochujang Beef Bowl at distance
  0.907 — a clear top hit — but distances across the whole corpus cluster tightly
  between 1.1 and 1.2, which is exactly what you'd expect from MiniLM on a tiny,
  semantically diverse set. It earns its place for natural-language queries that
  keywords genuinely cannot serve ("something cozy with chickpeas") and because
  the same embeddings feed exemplar retrieval for the generator. It is not here
  because the corpus needed a vector index.
- **The grocery list's store-section classifier is a keyword heuristic, not a
  food ontology.** Unrecognised items land in Pantry, which costs one extra
  glance in the shop. A real product would use a proper taxonomy.
- **Model prices are hardcoded** (as of 2026-06-24, in `telemetry.ts`) so cost
  shows up on the dashboard without another API dependency. They will go stale;
  the date is recorded so you know how much to trust the number.
- **The macro engine's 9% training-day surplus is a policy choice**, not
  physiology. So is the 35–45 g per-meal protein guide. Both are named constants,
  not derived truths.
- **Every test fixture is synthetic.** Body metrics are personal health data and
  this repo is public, so the macro and scheduler tests use invented round
  figures chosen to exercise each branch. One test in `macros.test.ts` validates
  against the real gitignored `seed.local.json` when it exists, and asserts
  _invariants_ rather than figures, so even its failure output can't leak the
  inputs. It skips silently in CI and on a fresh clone.
- **This is not medical advice**, and the app makes no claim that its targets are
  appropriate for anyone. It computes what it is told to compute.
- **Remaining `npm audit` findings** are 4 moderate advisories in `drizzle-kit`'s
  build-time `esbuild` (a dev-server issue, never shipped). The runtime tree is
  clean: a Drizzle SQL-injection advisory and a critical `protobufjs` transitive
  were both resolved by upgrading during the build, and `sharp` — pulled in by
  transformers for image preprocessing this app never invokes — is pinned forward
  via an override.

---

## How much of this was supervision

<!-- supervision:start -->

**Estimate: roughly 5 to 9 hours of active, engaged time**
across 2 working sessions —
writing the specification, making decisions, and reviewing output. Not writing
implementation code; almost none of that was typed by hand.

The estimate is derived, not measured. It comes from
[`supervision-log.json`](supervision-log.json), which records the round trips
per session — 57 so far — against a deliberately wide band of
4–8 minutes each: reading a long response, checking a diff or a
screenshot, deciding, replying. Sessions so far:

- **2026-08-07** — 15 exchanges. Original specification and the first build: fourteen features, fixed stack, phased order, target macro numbers.
- **2026-08-09** — 42 exchanges. Licence, re-skin, multi-meal planning, generator tab, demo mode built and cut, audit, Storybook, atomic restructure.

Treat the range as an order of magnitude. It excludes wall-clock time spent
waiting on builds, test runs and model calls, which is not engaged time, and it
almost certainly undercounts the minutes lost to re-reading something confusing.

This block is rewritten by `scripts/update-supervision.mjs` on every commit, so
the figure describes the repository as it currently stands rather than as it was
the day someone last remembered to edit it.

<!-- supervision:end -->

**The review was not passive, and that is the part worth reporting.** Several
defects listed above were found because the human asked the code to prove a
claim rather than accepting one.

So the productivity multiplier is real but it is not the whole story. The
defect log in this document is the price of the speed, and most of those bugs
were caught by supervision rather than by the tests — which is the argument for
the router and database tests that now exist, and against trusting an
unsupervised run.
