#!/usr/bin/env python3
"""Privacy floor for 小红书 rows: scrub title + summary for children's names and school
names before any row can go on the site. Cards may only use title, summary, and link
(no images, no author). Idempotent.

Usage: python3 /workspace/edu-hot/scripts/scrub-xhs.py
"""
from __future__ import annotations

import importlib.util
import json
import re
from datetime import datetime
from pathlib import Path

ROOT = Path("/workspace/edu-hot")
SRC_DIR = Path("/workspace/research/feishu-edu")
DEST = ROOT / ".data/xhs-scrubbed.json"
REPORT = ROOT / ".data/xhs-scrub-report.json"

spec = importlib.util.spec_from_file_location("iv", ROOT / "scripts/import-voices.py")
iv = importlib.util.module_from_spec(spec)
spec.loader.exec_module(iv)

KIN = r"(女儿|儿子|孩子|小孩|娃|闺女|大宝|二宝|宝宝)"
GENERIC_SCHOOL = re.compile(
    r"国家中小学|(?<![附])中小学|小学生|中学生|初中生|高中生|幼儿园到|到高中|小学至|幼小初高|按幼儿园"
)

RULES: list[tuple[re.Pattern, str | callable, str]] = [
    (re.compile(KIN + r"(?:叫|名叫|小名)?\s*([A-Z][a-z]{1,12})\b"), r"\1", "孩子英文名"),
    (re.compile(KIN + r"(?:叫|名叫|小名)([\u4e00-\u9fff]{1,3})"), r"\1", "孩子名字"),
    (re.compile(r"(名叫|小名叫|乳名是|大名是)[\u4e00-\u9fffA-Za-z]{1,8}"), "孩子", "孩子名字"),
]


def _school_repl(m: re.Match) -> str:
    raw = m.group(0)
    if GENERIC_SCHOOL.search(raw):
        return raw
    kind = m.group(2)
    return {"小学": "某小学", "幼儿园": "某幼儿园", "中学": "某中学", "附中": "某中学", "实验学校": "某学校", "外国语学校": "某学校"}.get(kind, "某学校")


SCHOOL_RX = re.compile(
    r"(?<![中小初高幼大])(?:(?![在去读上于到进的和与])[\u4e00-\u9fff]){2,10}(?:附属|第[一二三四五六七八九十\d]+)?(小学|幼儿园|中学|附中|实验学校|外国语学校)(?!生)"
)


def scrub_text(text: str) -> tuple[str, list[str]]:
    hits: list[str] = []
    s = text or ""
    for rx, repl, label in RULES:
        def sub(m, repl=repl, label=label):
            hits.append(label)
            return m.expand(repl) if isinstance(repl, str) else repl(m)
        s = rx.sub(sub, s)
    def school_sub(m: re.Match) -> str:
        raw = m.group(0)
        if GENERIC_SCHOOL.search(raw):
            return raw
        hits.append("学校名")
        return _school_repl(m)
    s = SCHOOL_RX.sub(school_sub, s)
    after = iv.sanitize(s)
    if after != s and "sanitize" not in hits:
        # sanitize only records a change if it actually redacted a name/school
        if after != s:
            hits.append("儿童姓名或学校名")
            s = after
    else:
        s = after
    return s, hits


def main() -> None:
    raw_rows = iv.load_all_xhs(SRC_DIR)
    items = []
    changed = []
    for r in raw_rows:
        title, h1 = scrub_text(r.get("title") or "")
        summary, h2 = scrub_text(r.get("summary") or "")
        hits = list(dict.fromkeys(h1 + h2))
        rec = {
            "url": r["url"],
            "title": title,
            "summary": summary,
            "redacted": bool(hits or title != (r.get("title") or "") or summary != (r.get("summary") or "")),
            "redactions": hits,
        }
        # Site card fields only. No author, no images, no captions.
        items.append(rec)
        if rec["redacted"]:
            changed.append({
                "url": r["url"],
                "redactions": hits,
                "title_before": r.get("title") or "",
                "title_after": title,
                "summary_before": r.get("summary") or "",
                "summary_after": summary,
            })
    generated = datetime.now().strftime("%Y-%m-%d %H:%M")
    DEST.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "generatedAt": generated,
        "timezone": "北京时间",
        "source": str(SRC_DIR),
        "note": "站点只允许使用标题、摘要、原帖链接；不含作者、图片或原帖图。原始采集未改。",
        "total": len(items),
        "redactedRows": len(changed),
        "items": items,
    }
    DEST.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    REPORT.write_text(json.dumps({
        "generatedAt": generated,
        "timezone": "北京时间",
        "total": len(items),
        "redactedRows": len(changed),
        "scrubbedData": str(DEST),
        "sourceUnchanged": str(SRC_DIR),
        "changes": changed,
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"小红书 {len(items)} 条，打码 {len(changed)} 条")
    print(f"清洗副本: {DEST}")
    print(f"变更报告: {REPORT}")
    for c in changed:
        print(" -", c["redactions"], c["url"])


if __name__ == "__main__":
    main()
