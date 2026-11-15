#!/usr/bin/env python3
"""Run scripts/reset-sequences.sql against DEST_DATABASE_URL (setval only).
Never prints the URL. Does not modify table data. Does not write an
unredacted log file.
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SQL = Path(os.environ.get("RESET_SEQUENCES_SQL") or ROOT / "scripts" / "reset-sequences.sql")

def redact(text: str) -> str:
    text = re.sub(r"postgres(?:ql)?://\S+", "postgres://***", text)
    text = re.sub(r"(password|pwd)=[^\s]+", r"\1=***", text, flags=re.I)
    text = re.sub(r"[A-Za-z0-9.-]+\.neon\.tech", "[neon-host]", text)
    text = re.sub(r"\bep-[A-Za-z0-9-]+", "[neon-ep]", text)
    return text

def main() -> None:
    url = os.environ.get("DEST_DATABASE_URL") or ""
    if not url:
        raise SystemExit("DEST_DATABASE_URL is not set.")
    if not SQL.is_file():
        raise SystemExit(f"missing {SQL}")
    proc = subprocess.run(
        ["psql", url, "-v", "ON_ERROR_STOP=1", "-f", str(SQL)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    out = redact(proc.stdout.decode("utf-8", "replace"))
    err = redact(proc.stderr.decode("utf-8", "replace"))
    if out.strip():
        print(out, end="" if out.endswith("\n") else "\n")
    if err.strip():
        print(err, end="" if err.endswith("\n") else "\n", file=sys.stderr)
    if proc.returncode != 0:
        raise SystemExit(f"sequence reset failed (exit {proc.returncode})")

if __name__ == "__main__":
    main()
