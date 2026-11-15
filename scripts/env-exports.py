#!/usr/bin/env python3
"""Read a KEY=VALUE env file (values may be quoted or unquoted) and print
bash `export` lines safe for `eval`.

Usage (do not run with `set -x`; do not run attached to a terminal):
  eval "$(python3 scripts/env-exports.py /path/to/file.env)"

docker --env-file does not strip quotes, so sibling writers should emit
unquoted values. This loader still accepts quoted values for older files.
Refuses to write to a TTY so URLs are not printed to the screen.
"""
from __future__ import annotations

import shlex
import sys
from pathlib import Path

def load(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    for ln in path.read_text(encoding="utf-8").splitlines():
        s = ln.strip()
        if not s or s.startswith("#") or "=" not in s:
            continue
        k, v = s.split("=", 1)
        k = k.strip()
        if not k or not k.isidentifier():
            raise SystemExit(f"refusing unexpected env key")
        v = v.strip().strip('"').strip("'")
        out[k] = v
    return out

def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: env-exports.py <file.env>")
    if sys.stdout.isatty():
        raise SystemExit("refusing to print exports to a terminal")
    path = Path(sys.argv[1])
    if not path.is_file():
        raise SystemExit(f"missing {path}")
    for k, v in load(path).items():
        if "\n" in v or "\r" in v:
            raise SystemExit(f"refusing a value with a newline for {k}")
        sys.stdout.write(f"export {k}={shlex.quote(v)}\n")

if __name__ == "__main__":
    main()
