# Untrusted planner, trusted verifier

When `plannerMode` is `ai`, the scheduler hands Claude four tools —
`list_recipes`, `get_recent_history`, `read_pantry_and_leftovers`, and
`propose_week` — and lets it plan the week. It is **not** trusted to have
followed the rules while doing so.

Every proposal goes through `verifyWeek()`, which checks:

- slot roles match what the settings imply
- leftover days carry no recipe
- meal types can actually fill their slots
- no excluded ingredient appears in any chosen recipe
- nothing inside the repeat window, and no repeat within the week
- per-week caps on tagged ingredients, from the user's dietary guidelines
- every meal passes a macro plausibility band

**The verifier is not a second implementation of the rules — it is the same
functions the deterministic planner is built from.** That is what makes it worth
anything. A verifier with its own copy of the logic is just a second thing to
get wrong.

`verifyWeek` returns *every* violation rather than the first, so a rejection can
be fed back complete — one round trip instead of N. The planner gets up to three
proposals. On continued rejection, an API failure, a missing key, or anything
else, the run **falls back to deterministic planning and records that it did**.

> The cron must never fail to produce a week. A clever plan is a nice-to-have; a
> plan is not.

Fallbacks and verifier verdicts are counted as metrics and shown on the weekly
plan page, so "the AI planner isn't working" is an observation, not a suspicion.

---
