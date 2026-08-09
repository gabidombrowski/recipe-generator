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

### Enable these on the GitHub repo

Both are free for public repositories and neither is on by default:

1. **Secret scanning with push protection** — *Settings → Code security →
   Secret protection*. Enable **Secret scanning** and then **Push protection**,
   which blocks a commit containing a recognised credential *before* it reaches
   the remote. This is the backstop for the `.gitignore` rules above.
2. **Dependabot** — *Settings → Code security*. Enable **Dependabot alerts**,
   **security updates**, and **version updates**; `.github/dependabot.yml` in
   this repo configures weekly npm, GitHub Actions, Docker and Terraform checks.

Also worth turning on: **CodeQL** (default setup), and a branch protection rule
on `main` requiring the CI and Evals checks to pass.

---

## Git hooks

Hooks live in `.githooks/` so they are reviewable and versioned like the rest of
the repo. Git does not use them until you point it there:

```bash
git config core.hooksPath .githooks
```

One hook so far. `pre-commit` regenerates the supervision estimate in
[honesty-notes.md](honesty-notes.md) from [supervision-log.json](supervision-log.json)
and stages it, so a figure that makes a claim about the project cannot quietly
describe an older, smaller version of it. It is fail-soft by design — no node,
or a broken script, logs and lets the commit through. A hook that guards a
documentation figure has no business blocking work.

The cost is that most commits touch `honesty-notes.md`. That is accepted: a
slightly noisier log is a fair price for a number that is never more than one
commit stale.
