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
# Usage (from /workspace/edu-hot; do not set -x, do not print env):
#   ./scripts/sync-to-neon.sh
#   SKIP_DAILY_REFRESH=1 ./scripts/sync-to-neon.sh   # skip the local daily rewrite
#
# Stage-and-swap: local tables are copied into Neon schema hot_stage, then
# swapped with public in one transaction. site_blobs is preserved if the
# local table is empty, then upserted so Vercel /tmp catalogs refresh.
#
# Loads /workspace/edu-hot/.secrets/neon.env
#   DATABASE_URL         = pooled (not used for DDL or restore)
#   DEST_DATABASE_URL    = direct (restore, migrate, site_blobs)
# Never enable `set -x`; URLs are never printed.
set -euo pipefail

if [[ -n "${-:-}" && "${-}" == *x* ]]; then
  echo "Refusing to run with shell tracing enabled (it would print the database URL)." >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# Host deps first: migrate.ts and sync-site-blobs.ts import @aihot/backend from node_modules.
"$ROOT/scripts/ensure-host-deps.sh"
NEON_ENV="${NEON_ENV:-$ROOT/.secrets/neon.env}"
if [[ ! -f "$NEON_ENV" ]]; then
  echo "Missing $NEON_ENV" >&2
  exit 1
fi

# Resolving via DoH avoids a fake-IP DNS resolver (198.18.0.0/15) on this box.
RESOLVED="${RESOLVED_ENV:-$ROOT/.secrets/neon.resolved.env}"
python3 "$ROOT/scripts/resolve-neon-urls.py" --src "$NEON_ENV" --out "$RESOLVED"

# Load via env-exports.py so quoted or unquoted values both work, and so
# `&` in hostaddr query strings is not interpreted by the shell. Do not `.`
# the resolved file; do not set -x.
eval "$(python3 "$ROOT/scripts/env-exports.py" "$RESOLVED")"

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
  API_CONTAINER="${API_CONTAINER:-xintian-edu-hot-api-1}"
  if docker exec -w /app "$API_CONTAINER" node /app/scripts/compose-daily.ts "$TODAY"; then
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

# Sequences stay in public across the swap and are not copied, so they can
# lag max(id) and the next insert hits a primary key. setval only; no data
# change. Run now so migrate.ts does not collide, and again after catalogs.
echo "Resetting sequences on Neon (setval only)…"
python3 "$ROOT/scripts/reset-dest-sequences.py"

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

echo "Resetting sequences on Neon after catalog upsert (setval only)…"
python3 "$ROOT/scripts/reset-dest-sequences.py"

# 4) Drop the Vercel CDN entries tagged edu-hot-public so visitors do not
# keep seeing pre-sync HTML / /api/site/* for up to s-maxage + SWR.
# Requires VERCEL_TOKEN in .secrets/vercel-api.env (never printed).
# The data is already on Neon at this point, so a missing token or a failed purge
# does not fail the sync. It is recorded in .data/cdn-purge.json and printed as a
# WARN; check-pipeline-health.py then checks the live non-ts URLs caught up and
# fails once they are still behind after s-maxage + SWR.
echo "Purging Vercel CDN cache…"
purge_rc=0
"$ROOT/scripts/purge-vercel-cdn.sh" || purge_rc=$?
case "$purge_rc" in
  0) purge_status="purged" ;;
  3) purge_status="no-token" ;;
  *) purge_status="failed" ;;
esac
printf '{"at":"%s","status":"%s","exitCode":%d}\n' "$(TZ=Asia/Shanghai date +%Y-%m-%dT%H:%M:%S+08:00)" "$purge_status" "$purge_rc" > "$ROOT/.data/cdn-purge.json"

if [[ "$purge_status" == "purged" ]]; then
  echo "sync-to-neon finished."
else
  echo "WARN: sync-to-neon finished, but the CDN cache was NOT purged ($purge_status). The live site may stay behind for up to 17 minutes (s-maxage 600 s + SWR 300 s + 120 s margin); check-pipeline-health.py reports HEALTH PENDING with a recheck time until then, and --only cdn after that time fails if it is still behind (docs/import-runbook.md, CDN 两步核对)." >&2
fi
