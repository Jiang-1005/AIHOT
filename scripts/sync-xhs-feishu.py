#!/usr/bin/env python3
"""Read-only Feishu Bitable sync for 小红书 rows into xhs-inbox.csv.

Pulls records from a Feishu Bitable table using tenant_access_token and merges new
posts (deduped by canonical URL) into the local CSV consumed by scrub-xhs.py and
import-voices.py. Never writes back to Feishu.

Required environment variables:
  FEISHU_APP_ID
  FEISHU_APP_SECRET
  FEISHU_BITABLE_APP_TOKEN
  FEISHU_BITABLE_TABLE_ID
Optional:
  FEISHU_BITABLE_VIEW_ID
  XHS_INBOX_CSV (default: /workspace/research/feishu-edu/xhs-inbox.csv)

Usage:
  python3 scripts/sync-xhs-feishu.py --dry-run
  python3 scripts/sync-xhs-feishu.py --output /workspace/research/feishu-edu/xhs-inbox.csv
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlencode, urlparse, urlunparse
from urllib.request import Request, urlopen

BJ = timezone(timedelta(hours=8))
DEFAULT_CSV = Path("/workspace/research/feishu-edu/xhs-inbox.csv")
FEISHU_API = "https://open.feishu.cn/open-apis"

CSV_HEADERS = [
    "原帖",
    "笔记标题",
    "讨论要点",
    "人群",
    "发布日期",
    "页面时间",
    "学生年龄段",
    "国家",
    "内容类型",
    "核验状态",
    "点赞",
    "收藏",
    "评论",
    "采集日期",
]


def canon_url(url: str) -> str:
    raw = (url or "").strip()
    m = re.search(r"https?://[^\s,，。；;\"'<>]+", raw)
    if not m:
        return ""
    u = m.group(0)
    p = urlparse(u)
    host = p.netloc.lower()
    if host.startswith("www."):
        host = host[4:]
    path = re.sub(r"/+$", "", p.path)
    return urlunparse(("https", host, path, "", "", ""))


def cell_text(val) -> str:
    if val is None:
        return ""
    if isinstance(val, (int, float)):
        if isinstance(val, int) and val > 10**11:
            dt = datetime.fromtimestamp(val / 1000, BJ)
            return dt.strftime("%Y-%m-%d")
        return str(val)
    if isinstance(val, str):
        return val.strip()
    if isinstance(val, dict):
        return str(val.get("link") or val.get("text") or val.get("name") or "").strip()
    if isinstance(val, list):
        parts = [cell_text(x) for x in val]
        return "、".join(p for p in parts if p)
    return str(val).strip()


def pick_field(fields: dict, *names: str) -> str:
    for name in names:
        if name in fields:
            val = cell_text(fields[name])
            if val:
                return val
    return ""


def http_json(url: str, *, method: str = "GET", headers: dict | None = None, body: dict | None = None) -> dict:
    hdrs = {"Content-Type": "application/json; charset=utf-8", **(headers or {})}
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = Request(url, data=data, headers=hdrs, method=method)
    with urlopen(req, timeout=20) as resp:
        payload = json.load(resp)
    if payload.get("code", 0) != 0:
        raise RuntimeError(f"Feishu API error {payload.get('code')}: {payload.get('msg')}")
    return payload


def get_tenant_token(app_id: str, app_secret: str) -> str:
    res = http_json(
        f"{FEISHU_API}/auth/v3/tenant_access_token/internal",
        method="POST",
        body={"app_id": app_id, "app_secret": app_secret},
    )
    token = res.get("tenant_access_token") or ""
    if not token:
        raise RuntimeError("Feishu returned empty tenant_access_token")
    return token


def fetch_records(token: str, app_token: str, table_id: str, view_id: str = "") -> list[dict]:
    records: list[dict] = []
    page_token = ""
    while True:
        qs: dict[str, str] = {"page_size": "500"}
        if view_id:
            qs["view_id"] = view_id
        if page_token:
            qs["page_token"] = page_token
        url = f"{FEISHU_API}/bitable/v1/apps/{app_token}/tables/{table_id}/records?{urlencode(qs)}"
        res = http_json(url, headers={"Authorization": f"Bearer {token}"})
        data = res.get("data") or {}
        records.extend(data.get("items") or [])
        if not data.get("has_more"):
            break
        page_token = data.get("page_token") or ""
        if not page_token:
            break
    return records


def record_to_row(fields: dict) -> dict[str, str] | None:
    url = canon_url(pick_field(fields, "原帖", "原帖链接", "链接", "URL", "url"))
    if not url:
        return None
    title = pick_field(fields, "笔记标题", "标题", "title")
    summary = pick_field(fields, "讨论要点", "摘要", "总结", "summary")
    if not title and not summary:
        return None
    now_str = datetime.now(BJ).strftime("%Y-%m-%d")
    return {
        "原帖": url,
        "笔记标题": title,
        "讨论要点": summary,
        "人群": pick_field(fields, "人群", "发布者身份", "身份"),
        "发布日期": pick_field(fields, "发布日期", "发布时间", "日期"),
        "页面时间": pick_field(fields, "页面时间"),
        "学生年龄段": pick_field(fields, "学生年龄段", "年龄段", "学段") or "未标注",
        "国家": pick_field(fields, "国家") or "中国",
        "内容类型": pick_field(fields, "内容类型", "类型"),
        "核验状态": pick_field(fields, "核验状态", "核验"),
        "点赞": pick_field(fields, "点赞", "点赞数"),
        "收藏": pick_field(fields, "收藏", "收藏数"),
        "评论": pick_field(fields, "评论", "评论数"),
        "采集日期": pick_field(fields, "采集日期") or now_str,
    }


def merge_csv(csv_path: Path, incoming: list[dict[str, str]], dry_run: bool = False) -> tuple[int, int]:
    existing: dict[str, dict[str, str]] = {}
    if csv_path.exists():
        with csv_path.open("r", encoding="utf-8-sig", newline="") as fh:
            for raw in csv.DictReader(fh):
                u = canon_url(raw.get("原帖") or "")
                if not u:
                    continue
                row = {h: (raw.get(h) or "").strip() for h in CSV_HEADERS}
                row["原帖"] = u
                existing[u] = row

    added = 0
    for row in incoming:
        u = row["原帖"]
        if u not in existing:
            added += 1
        existing[u] = row

    rows = list(existing.values())
    if not dry_run:
        csv_path.parent.mkdir(parents=True, exist_ok=True)
        with csv_path.open("w", encoding="utf-8", newline="") as fh:
            writer = csv.DictWriter(fh, fieldnames=CSV_HEADERS)
            writer.writeheader()
            writer.writerows(rows)
    return added, len(rows)


def main() -> None:
    ap = argparse.ArgumentParser(description="Read-only Feishu Bitable -> xhs-inbox.csv sync")
    ap.add_argument("--output", type=Path, default=Path(os.environ.get("XHS_INBOX_CSV") or DEFAULT_CSV))
    ap.add_argument("--dry-run", action="store_true", help="Fetch and print counts without writing CSV")
    args = ap.parse_args()

    app_id = os.environ.get("FEISHU_APP_ID", "").strip()
    app_secret = os.environ.get("FEISHU_APP_SECRET", "").strip()
    app_token = os.environ.get("FEISHU_BITABLE_APP_TOKEN", "").strip()
    table_id = os.environ.get("FEISHU_BITABLE_TABLE_ID", "").strip()
    view_id = os.environ.get("FEISHU_BITABLE_VIEW_ID", "").strip()

    missing = [k for k, v in (
        ("FEISHU_APP_ID", app_id),
        ("FEISHU_APP_SECRET", app_secret),
        ("FEISHU_BITABLE_APP_TOKEN", app_token),
        ("FEISHU_BITABLE_TABLE_ID", table_id),
    ) if not v]
    if missing:
        print(f"ERROR: missing Feishu env vars: {', '.join(missing)}", file=sys.stderr)
        sys.exit(1)

    token = get_tenant_token(app_id, app_secret)
    raw_records = fetch_records(token, app_token, table_id, view_id)
    mapped = [r for rec in raw_records if (r := record_to_row(rec.get("fields") or {})) is not None]
    added, total = merge_csv(args.output, mapped, dry_run=args.dry_run)
    mode = "DRY-RUN" if args.dry_run else "SYNCED"
    print(f"{mode} fetched={len(raw_records)} valid={len(mapped)} added={added} csv_total={total} target={args.output}")


if __name__ == "__main__":
    main()
