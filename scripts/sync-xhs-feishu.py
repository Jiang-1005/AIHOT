#!/usr/bin/env python3
"""Feishu is no longer the hot-post source.

2026-11-24：教育AIHOT 群决定以后用 Notion 导入，飞书表不再刷新。
本脚本不再申请 tenant_access_token，也不再写 xhs-inbox.csv。
"""
from __future__ import annotations

import sys

print(
    "飞书小红书同步已停用。热帖从 Notion 官方连接器的全量分页快照导入："
    "python3 scripts/notion-hotposts-snapshot.py seal --pages <connector-pages.json> --out <snapshot.json>",
    file=sys.stderr,
)
raise SystemExit(2)
