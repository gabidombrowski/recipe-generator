# Observability

OpenTelemetry SDK with a Prometheus exporter, started once from
`instrumentation.ts`. The exporter runs its **own HTTP server** bound to
loopback or the container network — not a Next route — so metrics are never
reachable through the public tunnel.

Per-generation spans and metrics record input/output tokens, computed USD cost
(cache reads billed at 0.1×, writes at 1.25×), latency, retries, fallback
outcome, and planner verifier verdicts.

Grafana dashboards: request latency, LLM cost per day, scheduler run history,
planner fallbacks and verifier verdicts, and the eval pass-rate trend — the last
ingested from the CI report JSON via `npm run evals:metrics`, served as a static
file and scraped like any other target.

**One alert**, deliberately: the app being unreachable *or* a scheduler run
having failed. Both mean the same thing in practice — no plan and no grocery list
this week — and both are things a single-user app can go days without noticing.
Everything else is for looking at on purpose, not for waking anyone up.

`pino` for structured logs, with API keys, cookies and email addresses redacted.
`/healthz` reports database reachability and whether sqlite-vec loaded, and
nothing else.

---
