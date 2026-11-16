#!/usr/bin/env python3
"""npm run verify:site -- <base-url>

Fails closed on:
  - style inventory outside spec tiers (font sizes, radii, weights)
  - /voices platform chip count != API count or == 0
  - missing 「数据截至」
Also writes multi-width screenshots (320/390/1440, light and dark).
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path
from urllib.parse import urlparse

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

TZ = timezone(timedelta(hours=8), name="Asia/Shanghai")


def usage() -> int:
    print("usage: npm run verify:site -- <base-url>", file=sys.stderr)
    return 2


def fetch_health(base: str) -> dict | None:
    try:
        req = urllib.request.Request(base + "/api/health", headers={"Accept": "application/json", "Cache-Control": "no-store"})
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r)
    except Exception as e:
        print(f"health: error {e}")
        return None


def main(argv: list[str]) -> int:
    args = [a for a in argv[1:] if a != "--"]
    if not args:
        return usage()
    base = args[0].rstrip("/")
    parsed = urlparse(base)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        print(f"invalid base url: {base}", file=sys.stderr)
        return 2
    host = parsed.netloc.replace(":", "_")
    stamp = datetime.now(TZ).strftime("%Y%m%d-%H%M%S")
    out = Path(args[1]) if len(args) > 1 else ROOT / "screenshots" / "verify-site" / f"{host}-{stamp}"
    out.mkdir(parents=True, exist_ok=True)
    style_dir = out / "style"
    voices_dir = out / "voices"
    print(f"verify:site base={base}")
    print(f"output={out}")
    print(f"time={datetime.now(TZ).isoformat()} Asia/Shanghai")

    health = fetch_health(base)
    if health:
        print(f"health: ok={health.get('ok')} release={health.get('release')} db={health.get('db')}")
    else:
        print("health: unreachable (continuing; style/voices checks may still fail)")

    failures = []

    # Import after the usage check so a missing playwright dep is a clear error.
    from style_inventory import run as style_run, violations as style_violations
    from voices_filters import run as voices_run
    import asyncio

    print("— style inventory + screenshots —")
    res = asyncio.run(style_run(base, str(style_dir)))
    style_bad = style_violations(res)
    for line in style_bad:
        print("BAD", line)
    if style_bad:
        print(f"style inventory FAIL ({len(style_bad)} violations)")
        failures.append("style")
    else:
        print("style inventory OK")

    print("— voices chips, 数据截至, filter clicks —")
    voices_bad = voices_run(base, str(voices_dir))
    if voices_bad:
        for line in voices_bad:
            print("BAD", line)
        print(f"voices filters FAIL ({len(voices_bad)} violations)")
        failures.append("voices")
    else:
        print("voices filters OK")

    summary = {
        "base": base,
        "out": str(out),
        "health": health,
        "style_violations": style_bad,
        "voices_violations": voices_bad,
        "ok": not failures,
    }
    (out / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    if failures:
        print(f"verify:site FAIL ({', '.join(failures)})")
        return 1
    print("verify:site OK")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
