#!/usr/bin/env python3
"""封存、核对 Notion 热帖快照，或在同步前检查导入戳记。

  python3 scripts/notion-hotposts-snapshot.py seal --pages connector-pages.json --out snapshot.json
  python3 scripts/notion-hotposts-snapshot.py seal --pages connector-pages.json --dry-run
  python3 scripts/notion-hotposts-snapshot.py check --snapshot snapshot.json
  python3 scripts/notion-hotposts-snapshot.py gate-sync --snapshot snapshot.json --stamp import-stamp.json

不访问 Notion，不读密钥。连接器行的形状见 docs/notion-hotposts.md。
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from notion_hotposts import main

if __name__ == "__main__":
    raise SystemExit(main())
