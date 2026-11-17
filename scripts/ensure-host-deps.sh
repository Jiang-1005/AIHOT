#!/usr/bin/env bash
# Host-side Node deps for the ops scripts (migrate.ts, sync-site-blobs.ts run on the box, not in Docker).
# A box restart can wipe node_modules; reinstall from the lockfile before anything imports @aihot/backend.
# Usage: source from another script after ROOT is set, or run directly.
set -euo pipefail
ROOT="${ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
if [[ ! -e "$ROOT/node_modules/@aihot/backend" ]]; then
  echo "host node_modules missing (no node_modules/@aihot/backend); running npm ci in $ROOT…"
  if ! (cd "$ROOT" && npm ci --no-audit --no-fund >/tmp/eduhot-npm-ci.log 2>&1); then
    echo "npm ci failed; see /tmp/eduhot-npm-ci.log. Stopping before any import or sync." >&2
    exit 1
  fi
  [[ -e "$ROOT/node_modules/@aihot/backend" ]] || { echo "npm ci finished but node_modules/@aihot/backend is still missing." >&2; exit 1; }
  echo "npm ci ok."
fi
