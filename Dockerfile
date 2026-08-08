# syntax=docker/dockerfile:1
#
# Multi-stage build producing a Next standalone server.
#
# This is the portable path. The primary deployment mirrors the other Next.js
# app on the same host — rsync the standalone output, restart under pm2 — which
# is what `.github/workflows/deploy.yml` does. See the README's Deployment
# section for which to use when.

# ---------------------------------------------------------------------------
# deps — install with the native toolchain available
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS deps
WORKDIR /app

# better-sqlite3 and sqlite-vec compile native addons.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

# ---------------------------------------------------------------------------
# build
# ---------------------------------------------------------------------------
FROM deps AS build
WORKDIR /app
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1

# The placeholder is passed per-RUN rather than as an ENV: an ENV named
# AUTH_SECRET is baked into the image metadata and shows up in `docker history`,
# which is a bad habit even when the value is fake. The real secret comes from
# the environment at runtime.
RUN AUTH_SECRET=build-time-placeholder npm run build

# ---------------------------------------------------------------------------
# runtime — no compilers, no dev dependencies
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DB_PATH=/data/nutrition.db

# curl is the health check; the rest is for the native modules' runtime deps.
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 1001 --create-home app \
 && mkdir -p /data \
 && chown -R app:app /data

COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public

# Read at runtime rather than bundled: migrations by the migrator, prompts by
# the generator (which hashes the file contents).
COPY --from=build --chown=app:app /app/drizzle ./drizzle
COPY --from=build --chown=app:app /app/prompts ./prompts

USER app
EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/healthz || exit 1

CMD ["node", "server.js"]
