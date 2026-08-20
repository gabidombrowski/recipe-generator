# Nutrition

A single-user meal planner. It computes macro targets from body metrics, plans a
week of dinners around cook days and leftover days, derives the grocery list
from that plan, and — optionally — generates novel recipes with Claude under
constraints that are checked in code rather than trusted.

It exists because the interesting parts of "eat according to a plan" are not the
arithmetic. They're the scheduling (cook once, eat twice, and the second portion
is _tomorrow's_ food), the constraint satisfaction (this ingredient is out, this
one is limited to once a week), and keeping a language model inside those
constraints reliably enough to trust it on a Sunday morning while you're asleep.

**[Try the interactive demo](https://digitallotusdev.com/recipe-generator)** — the
full UI over recorded data: generation is a replay, and nothing you do there is
saved.

Built with Next.js (App Router), tRPC v11, Drizzle + SQLite, Auth.js v5, and the
Anthropic API. Deployed as Next standalone output behind a reverse proxy under
pm2; the repo also carries an alternative Cloudflare Tunnel + Access topology
(`infra/`) for a host you control end to end.

---

## Architecture

The diagram shows the **tunnel topology** from `infra/`. The current
deployment is the simpler right-hand half — reverse proxy straight to the
app — with the app's own allowlist as the only identity gate, which is why
that gate is written to stand alone. The Terraform for the tunnel is
committed but has not been applied to the current deployment.

```text
                       ┌──────────────────────────────────────┐
  browser ── HTTPS ──▶  │ Cloudflare Access (identity layer 1) │
                       └───────────────┬──────────────────────┘
                                       │ tunnel (outbound only)
                       ┌───────────────▼──────────────────────┐
                       │ cloudflared                          │
                       └───────────────┬──────────────────────┘
                                       │
   ┌───────────────────────────────────▼──────────────────────────────────┐
   │ Next.js (standalone)                                                 │
   │                                                                      │
   │  middleware ──▶ deny by default; Auth.js JWT (identity layer 2)      │
   │       │                                                              │
   │  tRPC v11 ──▶ zod in / zod out ──▶ domain services                   │
   │       │                                │                             │
   │       │                    ┌───────────┼────────────┐                │
   │       │                    ▼           ▼            ▼                │
   │       │              macro engine  scheduler    grocery list         │
   │       │               (pure)      (pure rules)   (derived)           │
   │       │                                │                             │
   │       │                    ┌───────────┴──────────┐                  │
   │       │                    ▼                      ▼                  │
   │       │             deterministic          agentic planner ──┐       │
   │       │               planner                    │           │       │
   │       │                    ▲                     ▼           │       │
   │       │                    └────── fallback ── verifier ◀─────┘       │
   │       │                                                              │
   │  instrumentation.ts ──▶ OTel SDK · migrations · node-cron            │
   └───────────────────────────────┬──────────────────────────────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │ SQLite (better-sqlite3)     │
                    │  + sqlite-vec (embeddings)  │
                    └─────────────────────────────┘
```

**Where the logic lives, and why.** Everything that can be a pure function is
one. `src/lib/macros.ts` and `src/server/scheduler/rules.ts` have no imports
from the database, the network, or React — which is what makes them directly
testable, and what makes it possible for the deterministic planner and the LLM
verifier to be built from _the same rule definitions_ rather than two
implementations that drift.

| Path                     | What's in it                                                                                                     |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `src/lib/`               | Pure domain: zod schemas, macro engine, dietary guidelines and their input validator, calendar arithmetic, units |
| `src/server/db/`         | Drizzle schema, migrations, seeding, queries                                                                     |
| `src/server/scheduler/`  | Slot roles, the deterministic planner, the verifier, the cron                                                    |
| `src/server/llm/`        | Anthropic client, prompt loading, generator, agentic planner                                                     |
| `src/server/embeddings/` | Local MiniLM embeddings into sqlite-vec                                                                          |
| `src/server/trpc/`       | Routers — the only way the client reaches any of the above                                                       |
| `prompts/`               | Versioned prompt files, hashed per generation                                                                    |
| `src/lib/constraints.ts` | The constraint union, tag vocabulary, and prompt rendering                                                       |
| `evals/`                 | Fixtures, assertions, judge, runner                                                                              |
| `infra/`                 | Terraform: DNS, tunnel, Access application and policies                                                          |

**One convention worth knowing before reading the database code.** better-sqlite3
is synchronous, so Drizzle's query builders are not results — they must be
terminated with `.sync()`, `.all()`, `.get()`, or `.run()`. An un-terminated
`findFirst()` returns a builder object, which is _truthy_, so `if (existing)`
silently takes the wrong branch instead of throwing. This is documented at the
top of `src/server/db/index.ts` because it cost time once already.

---

---

## How it works

The design decisions worth reading about, each in its own document:

|                                                                     |                                                                            |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| [The macro engine](docs/macro-engine.md)                            | Every number on screen derived from the profile, with the arithmetic shown |
| [Planning](docs/planning.md)                                        | Cook days, leftover days, and a slot per meal per day                      |
| [Dietary rules](docs/dietary-rules.md)                              | Why the rules are data the user owns, not code                             |
| [Untrusted planner, trusted verifier](docs/planner-and-verifier.md) | The pattern that makes an LLM planner safe to trust on a Sunday morning    |
| [Structured generation](docs/structured-generation.md)              | Forced tool use, schemas as instructions, retries on rejection             |
| [Evals](docs/evals.md)                                              | Fixtures, hard gates, and the judge                                        |
| [Observability](docs/observability.md)                              | Traces, metrics, logs, health                                              |
| [Look and feel](docs/look-and-feel.md)                              | Where the visual design comes from                                         |
| [Deployment](docs/deployment.md)                                    | Reverse proxy + pm2; tunnel and container alternatives                     |
| [Repo hygiene](docs/repo-hygiene.md)                                | Keeping personal data out of a public repository                           |
| [Honesty notes](docs/honesty-notes.md)                              | What is weaker than it looks                                               |

If you read one, make it [untrusted planner, trusted verifier](docs/planner-and-verifier.md) — it is the idea the rest of the architecture is arranged around.

---

## Security

- **Auth.js v5**, GitHub provider, JWT session in an httpOnly / Secure /
  SameSite=Lax cookie. The `signIn` callback allowlists exactly one GitHub
  account id from `ALLOWED_GITHUB_ID` — not an email, because GitHub withholds
  the address of an account with a private one, and not a username, because
  those can be changed and then re-registered by somebody else. **An empty
  allowlist denies everyone** rather than admitting everyone — a misconfigured
  deploy should lock its owner out, not open the door.
- **Middleware denies by default.** Only `/healthz`, `/metrics`, `/signin` and
  Auth.js's own callback routes are public; adding a new page cannot accidentally
  ship unauthenticated. tRPC procedures re-check the session, which matters for
  anything invoked server-side.
- **Rate limits** on sign-in (10 / 10 min) and generation (10 / hour) — the
  latter because each call costs real money and a runaway loop shouldn't be able
  to run up a bill. In-process counters, which is the right tool for a
  single-instance app; the limitation is stated plainly in `rate-limit.ts`.
- **Security headers**: HSTS with preload, `X-Content-Type-Options: nosniff`,
  `frame-ancestors 'none'`, `Referrer-Policy: strict-origin-when-cross-origin`,
  and a baseline CSP with no `unsafe-eval`.
- **Two independent identity layers**: Cloudflare Access in front of the tunnel,
  the app's own allowlist behind it. Either alone would keep everyone else out.

---

## Running it

Requires **Node 22+**.

```bash
npm install
cp .env.example .env          # fill in AUTH_SECRET, AUTH_GITHUB_*, ALLOWED_GITHUB_ID
npm run db:generate           # only after changing the Drizzle schema
npm run db:migrate
npm run db:seed
npm run dev                   # development, with hot reload
```

For a production-style run of the same build the server deploys:

```bash
npm run build:standalone      # build + copy static assets into the output
npm start                     # loads .env from the repo root, then serves it
```

**Signing in locally.** Real GitHub sign-in needs the OAuth values in `.env`
*and* a `http://localhost:3000/api/auth/callback/github` callback on the
GitHub App — a detour when you just want to look at the app. Skip it:

```bash
npm run dev:signed-in
```

starts the dev server and opens the browser already signed in. It signs a
real Auth.js JWT with your own `AUTH_SECRET` — validated by the middleware
exactly like a genuine sign-in, no bypass flag that could accidentally
ship — and delivers it through a one-shot localhost helper (cookies are
host-scoped, not port-scoped, so a Set-Cookie from any localhost port lands
in the jar for port 3000). `npm run dev:session` prints the same cookie for
hand-pasting instead; the Playwright suite uses the same mechanism.

Generate an `AUTH_SECRET` with:

```bash
openssl rand -base64 32
```

On first run with an empty database the app opens a **setup wizard** for Profile
and Settings. To skip it, copy `seed.local.example.json` to `seed.local.json`
(gitignored) and put your own values in — the seeder loads it and marks setup
complete.

`ANTHROPIC_API_KEY` is optional. Without it, AI generation and agentic planner
mode are disabled, the scheduler runs deterministically, and everything else
works.

Optional, for natural-language search:

```bash
npm run embeddings:backfill   # downloads ~25 MB of model weights once
```

### Other commands

```bash
npm test              # unit tests: fast, hermetic, no network, no API key
npm run test:e2e      # Playwright smoke tests against a throwaway database
npm run evals         # the eval suite — costs money, needs ANTHROPIC_API_KEY
npm run lint
npm run typecheck
npm run db:studio     # Drizzle Studio
```

---

---

## How this was built

Written with heavy AI assistance — Claude wrote most of the implementation,
the tests and this documentation.

What was mine: the specification, the architectural calls, and the review. The
things that most changed the outcome were the latter.

Several of the bugs listed in [honesty notes](docs/honesty-notes.md) were found
that way: by asking the code to prove a claim instead of believing it.

---

## License

Copyright (C) 2026 Gabi Dombrowski

This program is free software: you can redistribute it and/or modify it under
the terms of the GNU General Public License as published by the Free Software
Foundation, either version 3 of the License, or (at your option) any later
version.

This program is distributed in the hope that it will be useful, but WITHOUT ANY
WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
PARTICULAR PURPOSE. See the GNU General Public License for more details.

You should have received a copy of the GNU General Public License along with
this program. If not, see <https://www.gnu.org/licenses/>.

SPDX identifier: `GPL-3.0-or-later`. The full text is in [LICENSE](LICENSE).

Note that the GPL's copyleft obligations attach on **distribution**, which
includes shipping this app as a binary or image to someone else — but running
your own private instance triggers nothing. If you deploy it as a network
service for others to use, GPLv3 still does not require you to publish your
changes; that is the AGPL, and this project is not under it.
