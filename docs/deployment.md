# Deployment

This app runs on a small shared VPS alongside another Next.js app, **the same
way that one does**: Next standalone output, rsync'd over SSH, run under `pm2`.

> Why that pattern rather than containers: the host already runs a Next.js app
> with `output: "standalone"` under pm2, using the four SSH secrets below. A
> second app that deploys the same way inherits a working, understood setup and
> the same secret names. The container path in `docker-compose.yml` is the
> portable alternative for a host without that history.

## First-time server setup

```bash
# on the server, in APP_PATH
mkdir -p data
cat > .env <<'EOF'
DB_PATH=/absolute/path/to/app/data/nutrition.db
TZ=UTC                    # your IANA zone; must match Settings.timezone
PORT=3200
AUTH_SECRET=...
AUTH_URL=https://your-hostname
AUTH_GITHUB_ID=...
AUTH_GITHUB_SECRET=...
ALLOWED_GITHUB_ID=          # curl -s https://api.github.com/users/<you> | jq .id
ANTHROPIC_API_KEY=...
METRICS_HOST=127.0.0.1
METRICS_PORT=9464
EOF
chmod 600 .env

set -a; . ./.env; set +a
pm2 start ecosystem.config.cjs
pm2 save
```

Then add these repository secrets — the same four names the other repos use, so
the values copy straight across: `SERVER_HOST`, `SERVER_USER`, `SERVER_SSH_KEY`,
`APP_PATH`.

Every push to `main` builds, rsyncs (excluding `data/`, so the database is never
deleted), backs up the SQLite file, restarts pm2 with `--update-env`, and
**fails the deploy if `/healthz` doesn't come back**. Migrations run at boot from
`instrumentation.ts`, before the first request is served.

## Public exposure

No inbound ports. `cloudflared` dials out and holds the connection open;
Cloudflare Access authenticates in front of it.

```bash
cd infra
cp terraform.tfvars.example terraform.tfvars   # fill in; gitignored
export CLOUDFLARE_API_TOKEN=...                # never in tfvars
terraform init
terraform apply

terraform output -raw tunnel_token             # → server .env as CLOUDFLARE_TUNNEL_TOKEN
```

State contains the tunnel secret and is gitignored. For anything beyond one
laptop, uncomment the remote backend in `infra/versions.tf`.

## Container alternative

`docker-compose.yml` runs the whole stack — app, cloudflared, Prometheus,
Grafana, and the eval-metrics file server — with a named volume at `DB_PATH` and
`restart: unless-stopped`. Nothing publishes a host port; Grafana and Prometheus
bind to loopback for access over an SSH tunnel. Use this on a host where you'd
rather have containers than pm2.

The image is ~780 MB, most of it `onnxruntime-node` for local embeddings. Drop
`onnxruntime-node` from `outputFileTracingIncludes` in `next.config.ts` to save
roughly 270 MB; semantic search then falls back to keyword matching, which the
library page labels honestly rather than hiding.

> **If you change the native dependencies, check `outputFileTracingIncludes`.**
> `sqlite-vec` and `onnxruntime-node` both resolve their binaries with a
> computed `require`, which Next's static tracing cannot see. Left out, they are
> simply absent from the standalone output and the app starts with
> `vectorSearch: "unavailable"` — degraded, but running, which is exactly the
> kind of failure that survives a deploy unnoticed. `/healthz` reports it.

## Backup

One line, run from cron. `.backup` is safe against a live connection in a way
`cp` is not:

```bash
sqlite3 "$DB_PATH" ".backup '/tmp/nutrition-$(date +%F).db'" && rsync -az "/tmp/nutrition-$(date +%F).db" backup-host:~/backups/ && rm "/tmp/nutrition-$(date +%F).db"
```

---

## Serving under a sub-path

Set the `BASE_PATH` repository **variable** (not a secret — it is not sensitive,
and as a secret GitHub masks it throughout the logs). The workflow passes it as
`NEXT_PUBLIC_BASE_PATH`, which Next bakes into every asset URL at build time.

Three things bite, all of them found by measuring rather than by reading docs:

1. **Middleware sees the prefix; route handlers do not.** `nextUrl.pathname`
   still carries it in middleware, and `nextUrl.basePath` is empty there. The
   middleware therefore strips it before matching the public-path allowlist and
   puts it back on redirects.

2. **Do not redirect the bare path to the trailing-slash form.** Next strips the
   trailing slash itself, so a proxy rule adding it back produces an infinite
   redirect. Use an exact-match `location` that proxies, alongside the prefix one.

3. **Auth.js cannot be told about the sub-path.** It builds every URL as
   `origin + basePath + action` and `basePath` has to remain `/api/auth`,
   because that is what the route handler sees. So it always advertises
   `redirect_uri = origin/api/auth/callback/<provider>`. `redirectProxyUrl` is
   not a way out: Auth.js sets `isOnRedirectProxy` whenever that URL's origin
   equals the request's — always true here — and then skips the override.

   Resolve it in the proxy instead. Register the OAuth callback at the
   **un-prefixed** path and rewrite it into the app:

   ```nginx
   location /api/auth/ {
       proxy_pass http://localhost:<port>/<base-path>/api/auth/;
   }
   ```

   `AUTH_URL` should then be the bare origin. Giving it a path makes Auth.js
   treat that path as its `basePath` and every auth route returns
   "Bad request."

   The cost is one carve-out in the host's root namespace. A sub-domain avoids
   all three problems and needs no `BASE_PATH` at all; prefer it unless the
   sub-path is a requirement.
