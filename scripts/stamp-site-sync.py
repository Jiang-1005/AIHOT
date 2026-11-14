#!/usr/bin/env python3
# Write .data/site-sync.json with the current Asia/Shanghai wall time.
# Called by sync-to-neon.sh after a successful stage; never prints secrets.
from __future__ import annotations

import json
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / ".data" / "site-sync.json"
now = datetime.now(ZoneInfo("Asia/Shanghai")).replace(microsecond=0)
payload = {"syncedAt": now.strftime("%Y-%m-%d %H:%M"), "syncedAtIso": now.isoformat()}
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"site-sync stamped {payload['syncedAt']} 北京时间")
