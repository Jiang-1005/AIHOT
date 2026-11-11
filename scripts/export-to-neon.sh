#!/usr/bin/env bash
# Dump the local Docker Postgres and restore it to a destination URL (typically Neon).
# Usage:
#   DEST_DATABASE_URL='postgres://…' ./scripts/export-to-neon.sh
# Optional:
#   SOURCE_CONTAINER=edu-hot-db-1
#   SOURCE_DATABASE_URL='postgres://…'   # if you are not using the Docker db
# The destination URL is never printed. Do not enable `set -x` around this script.
set -euo pipefail

if [[ -n "${-:-}" && "${-}" == *x* ]]; then
  echo "Refusing to run with shell tracing enabled (it would print the database URL)." >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${DEST_DATABASE_URL:-${DATABASE_URL_DEST:-}}"
if [[ -z "$DEST" ]]; then
  echo "Set DEST_DATABASE_URL to the Neon (or other) Postgres URL. The value will not be printed." >&2
  exit 1
fi

# On this box, system DNS may return a fake IP that accepts TCP:5432 but never finishes SSL.
# Rewrite via DoH + libpq hostaddr when talking to Neon and hostaddr is not already present.
case "$DEST" in
  *neon.tech*)
    case "$DEST" in
      *hostaddr=*) ;;
      *)
        NEON_ENV="${NEON_ENV:-$ROOT/.secrets/neon.env}"
        RESOLVED="${RESOLVED_ENV:-$ROOT/.secrets/neon.resolved.env}"
        if [[ -f "$NEON_ENV" ]]; then
          python3 "$ROOT/scripts/resolve-neon-urls.py" --src "$NEON_ENV" --out "$RESOLVED"
          set -a
          # shellcheck disable=SC1090
          . "$RESOLVED"
          set +a
          DEST="${DEST_DATABASE_URL:-$DEST}"
        fi
        ;;
    esac
    ;;
esac

DUMP="$(mktemp /tmp/edu-hot-dump.XXXXXX.dump)"
cleanup() { rm -f "$DUMP"; }
trap cleanup EXIT

if [[ -n "${SOURCE_DATABASE_URL:-}" ]]; then
  echo "Dumping source database…"
  pg_dump --no-owner --no-acl -Fc -d "$SOURCE_DATABASE_URL" -f "$DUMP"
else
  CONTAINER="${SOURCE_CONTAINER:-edu-hot-db-1}"
  export DOCKER_HOST="${DOCKER_HOST:-tcp://127.0.0.1:2375}"
  echo "Dumping Docker database from ${CONTAINER}…"
  docker exec "$CONTAINER" pg_dump -U aihot -d aihot --no-owner --no-acl -Fc > "$DUMP"
fi

SIZE="$(wc -c < "$DUMP" | tr -d ' ')"
echo "Dump written (${SIZE} bytes). Restoring to destination (owners/ACLs skipped)…"

# --clean --if-exists lets you re-run; Neon must be empty or willing to drop existing objects.
# Redact any URL that pg_restore might echo on error. Do not use `set -x`.
restore_log="$(mktemp /tmp/edu-hot-restore.XXXXXX.log)"
set +e
pg_restore --no-owner --no-acl --clean --if-exists -d "$DEST" "$DUMP" >"$restore_log" 2>&1
restore_rc=$?
set -e
python3 -c "
import re,sys
from pathlib import Path
t=Path(sys.argv[1]).read_text(errors='replace')
t=re.sub(r'postgres(?:ql)?://\S+','postgres://***',t)
t=re.sub(r'(password|pwd)=\S+','\\1=***',t,flags=re.I)
# keep the last 80 lines so a long restore is still diagnosable
lines=t.splitlines()
if len(lines)>80:
    print(f'(restore log truncated, {len(lines)} lines)')
    lines=lines[-80:]
print('\n'.join(lines))
" "$restore_log"
rm -f "$restore_log"
# pg_restore returns 1 when some objects warn (e.g. --clean on a fresh database). 0/1 are accepted;
# 2+ is a fatal archive error.
if [[ "$restore_rc" -ge 2 ]]; then
  echo "pg_restore failed with status ${restore_rc}." >&2
  exit "$restore_rc"
fi

echo "Restore finished. Apply any newer migrations with:"
echo "  DATABASE_URL=<same destination, not printed here> npm run db:migrate"
echo "Then upsert catalogs:"
echo "  DATABASE_URL=<same destination> node scripts/sync-site-blobs.ts"
