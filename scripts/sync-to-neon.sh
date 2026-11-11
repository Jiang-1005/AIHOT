#!/usr/bin/env bash
# Push the local Docker Postgres and catalog files to Neon.
# Intended to run on the box after each import (about 09:30 and 20:30 北京时间).
# This repo does not change the routine; hook this script after both import rounds.
#
# Before staging, refreshes today's daily on the local API container so the
# evening import is reflected in the current issue. After a successful stage,
# writes .data/site-sync.json (Beijing wall time) and upserts it so the site
# 「数据截至」label matches this sync. Do not run this at the same moment an
# import is still writing the local database.
#
# Usage (from the repo root; do not set -x, do not print env):
#   ./scripts/sync-to-neon.sh
#   SKIP_DAILY_REFRESH=1 ./scripts/sync-to-neon.sh   # skip the local daily rewrite
#
# Stage-and-swap: local tables are copied into Neon schema hot_stage, then
# swapped with public in one transaction. site_blobs is preserved if the
# local table is empty, then upserted so Vercel /tmp catalogs refresh.
#
# Loads .secrets/neon.env (override with NEON_ENV)
#   DATABASE_URL         = pooled (not used for DDL or restore)
#   DEST_DATABASE_URL    = direct (restore, migrate, site_blobs)
# Never enable `set -x`; URLs are never printed.
set -euo pipefail

if [[ -n "${-:-}" && "${-}" == *x* ]]; then
  echo "Refusing to run with shell tracing enabled (it would print the database URL)." >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NEON_ENV="${NEON_ENV:-$ROOT/.secrets/neon.env}"
if [[ ! -f "$NEON_ENV" ]]; then
  echo "Missing $NEON_ENV" >&2
  exit 1
fi

# Resolving via DoH avoids a fake-IP DNS resolver (198.18.0.0/15) on this box.
RESOLVED="${RESOLVED_ENV:-$ROOT/.secrets/neon.resolved.env}"
python3 "$ROOT/scripts/resolve-neon-urls.py" --src "$NEON_ENV" --out "$RESOLVED"

set -a
# shellcheck disable=SC1090
. "$RESOLVED"
set +a

if [[ -z "${DEST_DATABASE_URL:-}" ]]; then
  echo "DEST_DATABASE_URL is not set after resolving Neon URLs." >&2
  exit 1
fi

# 0) Rewrite today's daily after the morning or evening import so the issue
# matches the latest 精选. Skip with SKIP_DAILY_REFRESH=1. Do not run while
# an import is still writing the local database.
if [[ "${SKIP_DAILY_REFRESH:-}" != "1" ]]; then
  TODAY="$(TZ=Asia/Shanghai date +%F)"
  echo "Refreshing today's daily ($TODAY, 北京时间)…"
  if docker exec -w /app "${API_CONTAINER:-edu-hot-api-1}" node /app/scripts/compose-daily.ts "$TODAY"; then
    echo "today's daily refreshed."
  else
    echo "warning: today's daily refresh failed or was skipped; continuing sync." >&2
  fi
fi

# 1) schema+data: copy into hot_stage, then swap with public in one transaction.
# This replaces pg_restore --clean so the live site never reads a half-written
# public schema. Staging itself does not write the local database.
echo "Staging local data into Neon (hot_stage → swap)…"
python3 "$ROOT/scripts/sync-to-neon-stage.py"

# 2) migrations on the direct URL (poolers are a poor fit for DDL)
# neon-doh-dns.mjs pins Neon hostnames so postgres.js does not follow fake-IP DNS.
echo "Applying migrations on Neon (direct)…"
cd "$ROOT"
# migrate / blob upsert must use the direct URL; do not print it.
DATABASE_URL="$DEST_DATABASE_URL" node --import ./scripts/neon-doh-dns.mjs --env-file-if-exists=.env scripts/migrate.ts

# 3) voices / content-tags / site-sync catalogs
# Stamp 「数据截至」 to the actual Beijing time of this successful sync.
python3 "$ROOT/scripts/stamp-site-sync.py"
echo "Upserting site_blobs…"
DATABASE_URL="$DEST_DATABASE_URL" node --import ./scripts/neon-doh-dns.mjs --env-file-if-exists=.env scripts/sync-site-blobs.ts

# 4) Drop the Vercel CDN entries tagged edu-hot-public so visitors do not
# keep seeing pre-sync HTML / /api/site/* for up to s-maxage + SWR.
# Requires VERCEL_TOKEN in .secrets/vercel-api.env (never printed).
echo "Purging Vercel CDN cache…"
"$ROOT/scripts/purge-vercel-cdn.sh"

echo "sync-to-neon finished."
