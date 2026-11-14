#!/usr/bin/env python3
"""Idempotent DeepSeek tagger for media backlog and 小红书 notes.

X posts are NOT tagged here: import-voices.py reads grok-posts.json, then the
bak file, and only calls DeepSeek for new posts missing in both.

Daily (after the voices importer):

  python3 /workspace/edu-hot/scripts/tag-content.py

Writes /workspace/edu-hot/.data/content-tags.json and copies it to the API volume.
Does not print secrets.
"""
from __future__ import annotations

import json, os, sys, time, urllib.request, urllib.error
from datetime import datetime, timedelta, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
from facets import (  # noqa: E402
    normalize_tag_set, vocab_prompt_block, empty_tags, clean_companies,
)

BJ = timezone(timedelta(hours=8))
REPO = SCRIPT_DIR.parent
OUT = REPO / ".data" / "content-tags.json"


def now_bj() -> str:
    return datetime.now(BJ).strftime("%Y-%m-%d %H:%M")


def load_dotenv(path: Path):
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        v = v.strip().strip("'").strip('"')
        os.environ.setdefault(k.strip(), v)


def chat_json(messages, model: str, base: str, key: str, timeout=90) -> dict | list:
    url = base.rstrip("/")
    if not url.endswith("/v1"):
        url = url + "/v1"
    url = url + "/chat/completions"
    body = json.dumps({
        "model": model,
        "temperature": 0.1,
        "max_tokens": 4096,
        "messages": messages,
        "response_format": {"type": "json_object"},
    }).encode()
    req = urllib.request.Request(url, data=body, headers={
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    })
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = json.loads(resp.read().decode())
    text = data["choices"][0]["message"]["content"]
    return json.loads(text)


def already_tagged(store: dict, key: str) -> bool:
    item = (store.get("items") or {}).get(key)
    if not item:
        return False
    return item.get("topic") not in (None, "", "待定") or item.get("source") in {"upstream", "grok-posts", "bak", "deepseek"}


def merge_item(store: dict, key: str, rec: dict):
    store.setdefault("items", {})[key] = rec


def tag_batch(rows: list[dict], kind: str, key_field: str, model, base, api_key) -> list[dict]:
    payload = []
    for i, r in enumerate(rows):
        payload.append({
            "i": i,
            "id": r.get("id") or r.get("article_id") or "",
            "url": r.get("url") or "",
            "title": r.get("title") or "",
            "text": (r.get("text") or r.get("summary") or "")[:1800],
        })
    system = (
        "你是教育领域的资料标注员。根据词表给每条材料打五维标签。"
        "只输出一个 JSON 对象，形状为 {\"items\":[...]}，items 与输入条数、顺序一致。"
        "每条含 i, topic, subject, companies（数组）, form, content_type。"
        "不要编造原文没有的公司。无法判断的字段标「待定」。\n\n"
        + vocab_prompt_block()
    )
    user = "请标注：\n" + json.dumps(payload, ensure_ascii=False)
    try:
        out = chat_json(
            [{"role": "system", "content": system}, {"role": "user", "content": user}],
            model, base, api_key,
        )
    except Exception as e:
        print(f"  batch failed: {type(e).__name__}", flush=True)
        return []
    items = out.get("items") if isinstance(out, dict) else out
    if not isinstance(items, list):
        return []
    by_i = {}
    for it in items:
        if isinstance(it, dict) and "i" in it:
            by_i[int(it["i"])] = it
    tagged = []
    for i, r in enumerate(rows):
        it = by_i.get(i) or {}
        tags = normalize_tag_set({
            "topic": it.get("topic"),
            "subject": it.get("subject"),
            "companies": it.get("companies"),
            "form": it.get("form"),
            "content_type": it.get("content_type"),
        }) or empty_tags()
        tagged.append({
            "id": r.get("id") or r.get("article_id") or "",
            "url": r.get("url") or "",
            "title": r.get("title") or "",
            "kind": kind,
            **tags,
            "source": "deepseek",
            "taggedAt": now_bj(),
        })
    return tagged



def rewrite_company_aliases(store: dict) -> int:
    """Keep stored company tags on the alias map (e.g. 多邻国 + Duolingo → Duolingo（多邻国）)."""
    n = 0
    for rec in (store.get("items") or {}).values():
        before = list(rec.get("companies") or [])
        after = clean_companies(before)
        if after != before:
            rec["companies"] = after
            n += 1
    return n

def load_store() -> dict:
    if OUT.exists():
        try:
            return json.loads(OUT.read_text())
        except Exception:
            pass
    return {"generatedAt": "", "items": {}}


def save_store(store: dict):
    store["generatedAt"] = now_bj()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(store, ensure_ascii=False, indent=2) + "\n")
    # docker cp when available
    host = os.environ.get("DOCKER_HOST", "tcp://127.0.0.1:2375")
    try:
        import subprocess
        subprocess.run(
            ["docker", "cp", str(OUT), "xintian-edu-hot-api-1:/data/content-tags.json"],
            check=True, capture_output=True, text=True, env={**os.environ, "DOCKER_HOST": host},
        )
        print("copied to api:/data/content-tags.json", flush=True)
    except Exception as e:
        print("docker cp skipped:", e, file=sys.stderr)


def load_media(path: Path) -> list[dict]:
    if not path.exists():
        return []
    data = json.loads(path.read_text())
    return data if isinstance(data, list) else data.get("items") or []


def load_xhs():
    import importlib.util
    spec = importlib.util.spec_from_file_location("import_voices", SCRIPT_DIR / "import-voices.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    rows = mod.load_all_xhs(Path("/workspace/research/feishu-edu"))
    out = []
    for r in rows:
        out.append({
            "id": r.get("url") or "",
            "article_id": r.get("url") or "",
            "url": r.get("url") or "",
            "title": r.get("title") or "",
            "text": (r.get("summary") or r.get("title") or "")[:1800],
        })
    return out


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--media", default="/tmp/media-for-tags.json")
    ap.add_argument("--only", choices=["media", "xhs", "all"], default="all")
    ap.add_argument("--batch", type=int, default=8)
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    load_dotenv(REPO / ".env")
    key = os.environ.get("DEEPSEEK_API_KEY") or os.environ.get("LLM_API_KEY")
    base = os.environ.get("DEEPSEEK_BASE_URL") or os.environ.get("LLM_BASE_URL") or "https://api.deepseek.com"
    model = os.environ.get("LLM_MODEL") or "deepseek-chat"
    if not key:
        print("no API key in env, abort", file=sys.stderr)
        sys.exit(2)

    store = load_store()
    rewritten = rewrite_company_aliases(store)
    if rewritten:
        print(f"merged company aliases in {rewritten} stored rows", flush=True)
    jobs = []
    if args.only in ("media", "all"):
        jobs.append(("media", load_media(Path(args.media))))
    if args.only in ("xhs", "all"):
        jobs.append(("xhs", load_xhs()))

    total_new = 0
    for kind, rows in jobs:
        pending = []
        for r in rows:
            key_id = r.get("article_id") or r.get("id") or r.get("url")
            if not key_id:
                continue
            # already tagged?
            existing = (store.get("items") or {}).get(key_id) or (store.get("items") or {}).get(r.get("url") or "")
            if existing and existing.get("source") in {"deepseek", "upstream", "grok-posts", "bak"} and existing.get("topic") not in (None, ""):
                continue
            pending.append(r)
        if args.limit:
            pending = pending[: args.limit]
        print(f"{kind}: {len(rows)} loaded, {len(pending)} to tag", flush=True)
        batch_n = args.batch
        for i in range(0, len(pending), batch_n):
            chunk = pending[i : i + batch_n]
            tagged = tag_batch(chunk, kind, "url", model, base, key)
            for rec in tagged:
                merge_item(store, rec["id"] or rec["url"], rec)
                if rec["url"] and rec["url"] != rec["id"]:
                    merge_item(store, rec["url"], rec)
                total_new += 1
            save_store(store)
            print(f"  {kind} {min(i+batch_n, len(pending))}/{len(pending)}", flush=True)
            time.sleep(0.3)
    print(json.dumps({"tagged_new": total_new, "store": len(store.get("items") or {}), "at": now_bj()}, ensure_ascii=False))


if __name__ == "__main__":
    main()
