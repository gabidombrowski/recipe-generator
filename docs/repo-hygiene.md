# Public repo hygiene

This repository is public. No personal data or secrets are committed, ever.

**Committed** (neutral placeholders): `.env.example`,
`seed.local.example.json`, `nutrition-context.example.md`,
`infra/terraform.tfvars.example`.

**Gitignored** (real values): `.env`, the SQLite files, `seed.local.json`,
`nutrition-context.md`, `terraform.tfstate*`, `*.tfvars`, local eval reports.

Committed code ships neutral defaults and an empty setup state, so a fresh clone
gets the wizard rather than someone else's body metrics. All identities,
hostnames and zone ids come from environment variables or gitignored tfvars —
never literals.

---
