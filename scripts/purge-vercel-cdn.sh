#!/usr/bin/env bash
# Drop the public CDN cache tagged edu-hot-public after a Neon sync
# (or any other time the production HTML/API must refresh immediately).
#
# Relies on Vercel tag purge, not a new deployment:
#   POST /v1/edge-cache/dangerously-delete-by-tags
#   https://vercel.com/docs/rest-api/edge-cache/dangerously-delete-by-tag
# Delete (not merely invalidate) so the next visitor is a MISS against fresh
# Neon data. Invalidate would keep serving the old body as STALE until a
# background revalidation finishes.
#
# Auth: VERCEL_TOKEN from the environment or $ROOT/.secrets/vercel-api.env
#   (never print the file or enable set -x). Create a token at
#   https://vercel.com/account/tokens with access to this project.
# Project defaults can be overridden with VERCEL_PROJECT_ID / VERCEL_TEAM_ID.
#
# Usage (from /workspace/edu-hot):
#   ./scripts/purge-vercel-cdn.sh
#
# Exit codes (sync-to-neon.sh records them in .data/cdn-purge.json and keeps going;
# check-pipeline-health.py then verifies the live, non-ts URLs caught up):
#   0  purged (deleted or invalidated)
#   1  token present but both Vercel calls failed
#   3  no VERCEL_TOKEN: nothing was purged
set -euo pipefail

if [[ -n "${-:-}" && "${-}" == *x* ]]; then
  echo "Refusing to run with shell tracing enabled (it would print the Vercel token)." >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TOKEN_ENV="${VERCEL_API_ENV:-$ROOT/.secrets/vercel-api.env}"
if [[ -z "${VERCEL_TOKEN:-}" && -f "$TOKEN_ENV" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "$TOKEN_ENV"
  set +a
fi

PROJECT_ID="${VERCEL_PROJECT_ID:-prj_e0bCAbyQuAtacmGlJmRo6LLquniy}"
TEAM_ID="${VERCEL_TEAM_ID:-team_Zi76VbaJw6q9rWyQu7psA3pw}"
TAG="${VERCEL_CACHE_TAG:-edu-hot-public}"

if [[ -z "${VERCEL_TOKEN:-}" ]]; then
  echo "WARN: CDN cache NOT purged: no VERCEL_TOKEN (set it in $TOKEN_ENV)." >&2
  echo "WARN: the live site may keep serving the pre-sync pages and /api/site/* for up to s-maxage + stale-while-revalidate (600 s + 300 s = 15 minutes)." >&2
  exit 3
fi

url="https://api.vercel.com/v1/edge-cache/dangerously-delete-by-tags?projectIdOrName=${PROJECT_ID}&teamId=${TEAM_ID}"
# Body only; do not log the Authorization header.
tmp="$(mktemp)"
code="$(curl -sS -o "$tmp" -w "%{http_code}" -X POST "$url" \
  -H "Authorization: Bearer ${VERCEL_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"tags\":[\"${TAG}\"],\"target\":\"production\"}" \
  --max-time 30 || true)"

if [[ "$code" == "200" ]]; then
  echo "Vercel CDN cache deleted for tag ${TAG} (production)."
  rm -f "$tmp"
  exit 0
fi

echo "dangerously-delete-by-tags returned HTTP ${code}; trying invalidate-by-tags…" >&2
url2="https://api.vercel.com/v1/edge-cache/invalidate-by-tags?projectIdOrName=${PROJECT_ID}&teamId=${TEAM_ID}"
code2="$(curl -sS -o "$tmp" -w "%{http_code}" -X POST "$url2" \
  -H "Authorization: Bearer ${VERCEL_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"tags\":[\"${TAG}\"],\"target\":\"production\"}" \
  --max-time 30 || true)"

if [[ "$code2" == "200" ]]; then
  echo "Vercel CDN cache invalidated for tag ${TAG} (production). Next request may be served STALE while it revalidates."
  rm -f "$tmp"
  exit 0
fi

echo "Failed to purge Vercel CDN cache (delete HTTP ${code}, invalidate HTTP ${code2}). Token is not printed. A new production deployment will also drop the old cache." >&2
rm -f "$tmp"
exit 1
