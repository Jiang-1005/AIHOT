#!/usr/bin/env python3
"""Notion 热帖快照协议。

官方连接器分页得到的行，和站点要导入的冻结快照，是两份不同的文件。
本模块不读取密钥，不访问 Notion，也不猜测未在连接器结果里出现的 API。

连接器行里的 url 是 Notion 页面地址。原帖在「原帖」，去重键在「原帖键」。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
from facets import CONTENT_TYPES, TOPICS  # noqa: E402

PROTOCOL = "edu-hot-notion-hotposts-snapshot-v1"
CONNECTOR_PAGINATION = "notion-connector-pagination-v1"
DATA_SOURCE = "collection://42234f5e-fb6e-8142-814f-000b742fd940"
DATABASE_URL = "https://app.notion.com/p/42234f5efb6e81ed86dcf9223807d9d4"
DATABASE_ID = "42234f5e-fb6e-81ed-86dc-f9223807d9d4"
VIEW = "view://42234f5e-fb6e-81b6-bb70-000c6b7060aa"
MAP_PATH = SCRIPT_DIR / "notion-hotposts-content-types.json"
OPENED_ACCESS = {"原帖已打开", "图文已打开", "视频已播放"}
X_URL_RE = re.compile(r"^https://(?:www\.)?(?:x|twitter)\.com/([A-Za-z0-9_]{1,15})/status/(\d+)/?$", re.I)
XHS_URL_RE = re.compile(r"^https://(?:www\.)?xiaohongshu\.com/explore/([0-9a-fA-F]+)/?$", re.I)


class GateError(Exception):
    """快照或导入不能继续。消息只描述缺了什么，不带密钥或跟踪参数。"""


def load_content_type_map(path: Path | None = None) -> dict:
    file = path or MAP_PATH
    try:
        data = json.loads(file.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise GateError(f"缺少内容类型对照表 {file.name}") from exc
    except json.JSONDecodeError as exc:
        raise GateError(f"内容类型对照表不是 JSON：{file.name}") from exc
    vocab = data.get("grok_content_types")
    if vocab != CONTENT_TYPES:
        raise GateError("内容类型对照表的 grok_content_types 与站点词表不一致")
    entries = data.get("notion_content_types")
    if not isinstance(entries, dict) or not entries:
        raise GateError("内容类型对照表没有 notion_content_types")
    for name, entry in entries.items():
        if not isinstance(entry, dict):
            raise GateError(f"内容类型对照项 {name} 不是对象")
        review = entry.get("review")
        site = entry.get("site_content_type")
        if review == "accepted":
            if site not in CONTENT_TYPES:
                raise GateError(f"已审映射 {name} 的站点类型不在词表内，拒绝使用")
        elif site not in (None, ""):
            raise GateError(f"未审映射 {name} 不能预先填站点类型")
    return data


def resolve_content_type(notion_value, mapping: dict | None = None) -> dict:
    """对照表说了算。连接器里的值即使和某个 grok 选项很像，也不自动套用。"""
    mapping = mapping or load_content_type_map()
    if notion_value in (None, ""):
        return {"notion": None, "site_content_type": None, "review": "missing", "needs_review": True}
    entry = mapping["notion_content_types"].get(notion_value)
    if entry is None:
        return {"notion": notion_value, "site_content_type": None, "review": "unmapped", "needs_review": True}
    if entry.get("review") != "accepted":
        return {
            "notion": notion_value,
            "site_content_type": None,
            "review": entry.get("review") or "unreviewed",
            "needs_review": True,
        }
    return {
        "notion": notion_value,
        "site_content_type": entry["site_content_type"],
        "review": "accepted",
        "needs_review": False,
    }


def _parse_multi(value) -> list[str]:
    if value is None or value == "":
        return []
    if isinstance(value, list):
        return [str(item) for item in value]
    if isinstance(value, str) and value.strip().startswith("["):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError as exc:
            raise GateError("多选字段无法解析") from exc
        if not isinstance(parsed, list):
            raise GateError("多选字段不是列表")
        return [str(item) for item in parsed]
    return [str(value).strip()]


def verification_of(status_value, access_value) -> tuple[list[str], bool]:
    status = _parse_multi(status_value)
    access = (access_value or "").strip()
    verified = (
        "原帖已核" in status
        and "部分待核" not in status
        and "推断" not in status
        and access in OPENED_ACCESS
    )
    return status, verified


def _optional_date(row: dict, key: str, label: str) -> str | None:
    if key not in row or row.get(key) in (None, ""):
        return None
    match = re.match(r"^(\d{4}-\d{2}-\d{2})", str(row.get(key)).strip())
    if not match:
        raise GateError(f"{label} 无法解析，已拒绝这条，不用采集日期或页面时间填上")
    return match.group(1)


def _optional_int(row: dict, key: str):
    if key not in row or row.get(key) in (None, ""):
        return None
    value = row.get(key)
    if isinstance(value, bool) or isinstance(value, float):
        raise GateError(f"{key} 不是整数")
    if isinstance(value, int):
        return value
    if isinstance(value, str) and re.fullmatch(r"-?\d+", value.strip()):
        return int(value.strip())
    raise GateError(f"{key} 不是整数")


def _interaction_label(value: str) -> str:
    text = (value or "").strip()
    match = re.match(r"^\[([^\]]+)\]\(https?://[^)]+\)$", text)
    if match:
        return match.group(1).strip()
    return re.sub(r"https?://\S+", lambda item: item.group(0).split("?", 1)[0], text)


def _radar_content_type(text: str | None) -> str | None:
    if not text:
        return None
    plain = text.replace("<br />", "\n").replace("<br/>", "\n")
    for line in plain.splitlines():
        line = line.strip()
        if not line.startswith("内容类型"):
            continue
        parts = re.split(r"[　\s:：]+", line, maxsplit=1)
        if len(parts) == 2 and parts[1].strip():
            return parts[1].strip()
    return None


def _joined(value) -> str:
    parts = [part for part in _parse_multi(value) if part]
    return "、".join(parts)


def normalize_connector_row(row: dict) -> dict:
    if not isinstance(row, dict):
        raise GateError("连接器行不是对象")
    platform = row.get("来源平台")
    raw_url = (row.get("原帖") or "").strip()
    raw_key = (row.get("原帖键") or "").strip()
    if not raw_url or not raw_key or not platform:
        raise GateError("缺少来源平台、原帖或原帖键")
    if platform == "X":
        match = X_URL_RE.match(raw_url.split("?", 1)[0])
        key_match = re.fullmatch(r"x:(\d+)", raw_key)
        if not match or not key_match or match.group(2) != key_match.group(1):
            raise GateError(f"X 原帖与原帖键不一致：{raw_key or '空'}")
        canonical = f"https://x.com/{match.group(1)}/status/{match.group(2)}"
        post_key = f"x:{match.group(2)}"
    elif platform == "小红书":
        match = XHS_URL_RE.match(raw_url.split("?", 1)[0])
        key_match = re.fullmatch(r"xhs:([0-9a-fA-F]+)", raw_key)
        if not match or not key_match or match.group(1).lower() != key_match.group(1).lower():
            raise GateError(f"小红书原帖与原帖键不一致：{raw_key or '空'}")
        note_id = key_match.group(1).lower()
        canonical = f"https://www.xiaohongshu.com/explore/{note_id}"
        post_key = f"xhs:{note_id}"
    else:
        raise GateError(f"不支持的来源平台：{platform}")
    status, verified = verification_of(row.get("核验状态"), row.get("访问状态"))
    page_url = row.get("url") if isinstance(row.get("url"), str) else ""
    notion_page = page_url if page_url.startswith("https://app.notion.com/") or page_url.startswith("https://www.notion.so/") else None
    topic = row.get("X 话题")
    return {
        "platform": platform,
        "post_key": post_key,
        "canonical_url": canonical,
        "notion_page_url": notion_page,
        "title": row.get("笔记标题") or "",
        "summary": row.get("讨论要点") or "",
        "author": row.get("作者") or "",
        "published_on": _optional_date(row, "date:发布日期:start", "发布日期"),
        "captured_on": _optional_date(row, "date:采集日期:start", "采集日期"),
        "verification_status": status,
        "access_status": (row.get("访问状态") or "").strip(),
        "verified": verified,
        "interaction_source": _interaction_label(row.get("互动来源") or ""),
        "interaction_caption": row.get("互动口径") or "",
        "likes": _optional_int(row, "点赞"),
        "collects": _optional_int(row, "收藏"),
        "comments": _optional_int(row, "评论"),
        "reposts": _optional_int(row, "转发"),
        "crowd": (row.get("人群") or "").strip(),
        "source_name": (row.get("信源") or "").strip(),
        "age_range": _joined(row.get("学生年龄段")) or "未标注",
        "country": _joined(row.get("国家")) or "未标注",
        "notion_content_type": (row.get("内容类型") or "").strip() or None,
        "radar_content_type": _radar_content_type(row.get("X 采集标注")),
        "notion_topic": topic.strip() if isinstance(topic, str) and topic.strip() else None,
        "notion_direction": row.get("方向").strip() if isinstance(row.get("方向"), str) and row.get("方向").strip() else None,
        "feishu_record_id": (row.get("飞书记录 ID") or "").strip(),
    }


def posts_sha256(posts: list[dict]) -> str:
    payload = json.dumps(posts, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _reject_feishu_shape(obj) -> None:
    data = obj.get("data") if isinstance(obj, dict) else None
    fields = data.get("fields") if isinstance(data, dict) else None
    if isinstance(fields, list) and "原帖" in fields and "笔记标题" in fields:
        raise GateError("这是飞书矩阵导出，不能当作 Notion 快照封存")


def _require_source(bundle: dict) -> dict:
    query = bundle.get("query") if isinstance(bundle.get("query"), dict) else {}
    if bundle.get("protocol") != CONNECTOR_PAGINATION:
        raise GateError("缺少 notion-connector-pagination-v1。合并后的 results 不能单独封存")
    if bundle.get("data_source") != DATA_SOURCE or bundle.get("database_id") != DATABASE_ID:
        raise GateError("data_source 或 database_id 与 AI 教育热帖库不一致")
    if bundle.get("database_url") != DATABASE_URL or bundle.get("view") != VIEW:
        raise GateError("数据库 URL 或视图与约定的全量视图不一致")
    if query.get("mode") != "view" or query.get("archive_status") != "all":
        raise GateError("分页必须是 mode=view 且 archive_status=all，避免默认视图把行滤掉")
    fetched = bundle.get("fetched_at") or ""
    if not isinstance(fetched, str) or not re.search(r"(Z|[+-]\d{2}:\d{2})$", fetched):
        raise GateError("fetched_at 需要带时区")
    return query


def seal_pages(bundle: dict) -> dict:
    if not isinstance(bundle, dict):
        raise GateError("分页文件不是对象")
    _reject_feishu_shape(bundle)
    if "results" in bundle and "pages" not in bundle:
        raise GateError("这是连接器合并结果，不是分页封存。缺少最后一页 has_more=false，不能当完整快照")
    _require_source(bundle)
    pages = bundle.get("pages")
    if not isinstance(pages, list) or not pages:
        raise GateError("分页为空，拒绝封存")
    seen_index = []
    posts = []
    seen_keys = set()
    page_keys = []
    for expected, page in enumerate(pages, start=1):
        if not isinstance(page, dict):
            raise GateError("某一页不是对象")
        if page.get("index") != expected:
            raise GateError(f"分页序号不连续，停在第 {expected} 页")
        seen_index.append(expected)
        has_more = page.get("has_more")
        if not isinstance(has_more, bool):
            raise GateError(f"第 {expected} 页缺少 has_more")
        is_last = expected == len(pages)
        if has_more is is_last:
            raise GateError("最后一页必须 has_more=false，前面的页必须 has_more=true；当前是断点或不完整快照")
        results = page.get("results")
        if not isinstance(results, list) or not results:
            raise GateError(f"第 {expected} 页没有行，拒绝断点快照")
        page_size = page.get("page_size")
        if not isinstance(page_size, int) or page_size < 1:
            raise GateError(f"第 {expected} 页缺少 page_size")
        if not is_last and len(results) != page_size:
            raise GateError(f"第 {expected} 页行数短于 page_size，像是中途断开")
        if is_last and len(results) > page_size:
            raise GateError(f"第 {expected} 页行数超过 page_size")
        keys = []
        for raw in results:
            post = normalize_connector_row(raw)
            if post["post_key"] in seen_keys:
                raise GateError(f"原帖键重复：{post['post_key']}")
            seen_keys.add(post["post_key"])
            posts.append(post)
            keys.append(post["post_key"])
        page_keys.append(keys)
    declared = bundle.get("declared_n")
    if declared is not None and declared != len(posts):
        raise GateError(f"declared_n={declared} 与行数 {len(posts)} 不一致")
    posts.sort(key=lambda item: item["post_key"])
    snapshot = {
        "protocol": PROTOCOL,
        "source": {
            "kind": "notion-official-connector",
            "data_source": DATA_SOURCE,
            "database_url": DATABASE_URL,
            "database_id": DATABASE_ID,
            "view": VIEW,
            "query": {"mode": "view", "archive_status": "all"},
            "fetched_at": bundle["fetched_at"],
            "note": "连接器行的 url 是 Notion 页面。canonical_url 只来自原帖，查询串已去掉。",
        },
        "pagination": {
            "complete": True,
            "page_count": len(seen_index),
            "has_more_final": False,
            "declared_n": len(posts),
            "row_count": len(posts),
            "page_post_keys": page_keys,
        },
        "integrity": {"rows_sha256": posts_sha256(posts)},
        "posts": posts,
    }
    verify_snapshot(snapshot)
    return snapshot


def verify_snapshot(snapshot: dict) -> None:
    if not isinstance(snapshot, dict) or snapshot.get("protocol") != PROTOCOL:
        raise GateError("不是 edu-hot-notion-hotposts-snapshot-v1")
    _reject_feishu_shape(snapshot)
    source = snapshot.get("source") if isinstance(snapshot.get("source"), dict) else {}
    if source.get("kind") != "notion-official-connector":
        raise GateError("快照来源不是官方连接器冻结")
    if source.get("data_source") != DATA_SOURCE or source.get("view") != VIEW:
        raise GateError("快照的库或视图与约定不一致")
    query = source.get("query") if isinstance(source.get("query"), dict) else {}
    if query.get("mode") != "view" or query.get("archive_status") != "all":
        raise GateError("快照不是全量视图")
    pagination = snapshot.get("pagination") if isinstance(snapshot.get("pagination"), dict) else {}
    if pagination.get("complete") is not True or pagination.get("has_more_final") is not False:
        raise GateError("快照标记为不完整，拒绝导入")
    posts = snapshot.get("posts")
    if not isinstance(posts, list) or not posts:
        raise GateError("快照没有帖子")
    if pagination.get("row_count") != len(posts) or pagination.get("declared_n") != len(posts):
        raise GateError("快照行数与分页声明不一致")
    keys = [post.get("post_key") for post in posts]
    if keys != sorted(keys) or len(keys) != len(set(keys)):
        raise GateError("快照原帖键未排序或有重复")
    flat = [key for page in pagination.get("page_post_keys") or [] for key in page]
    if sorted(flat) != keys or len(flat) != len(keys):
        raise GateError("分页键与帖子列表不一致，快照不完整")
    digest = (snapshot.get("integrity") or {}).get("rows_sha256")
    if digest != posts_sha256(posts):
        raise GateError("快照哈希不符")
    for post in posts:
        if str(post.get("canonical_url") or "").startswith("https://app.notion.com/"):
            raise GateError("canonical_url 不能是 Notion 页面地址")
        if "xsec_token" in json.dumps(post, ensure_ascii=False):
            raise GateError("快照帖子里还有跟踪参数，拒绝封存")


def load_snapshot(path: Path) -> dict:
    try:
        snapshot = json.loads(Path(path).read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise GateError("热帖快照文件不存在") from exc
    except json.JSONDecodeError as exc:
        raise GateError("热帖快照不是 JSON") from exc
    verify_snapshot(snapshot)
    return snapshot


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def assert_sync_allowed(snapshot_path: Path, stamp_path: Path) -> None:
    snapshot = load_snapshot(snapshot_path)
    try:
        stamp = json.loads(Path(stamp_path).read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise GateError("没有导入戳记，不能同步") from exc
    except json.JSONDecodeError as exc:
        raise GateError("导入戳记不是 JSON，不能同步") from exc
    if stamp.get("ok") is not True:
        raise GateError("导入戳记不是 ok，不能同步")
    digest = snapshot["integrity"]["rows_sha256"]
    if stamp.get("snapshot_sha256") != digest:
        raise GateError("导入戳记的哈希和当前快照不一致，不能同步")


def topic_for_site(notion_topic: str | None) -> str | None:
    if notion_topic in TOPICS:
        return notion_topic
    return None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="封存或核对 Notion 热帖快照。不访问 Notion，不读密钥。")
    sub = parser.add_subparsers(dest="cmd", required=True)
    seal = sub.add_parser("seal")
    seal.add_argument("--pages", required=True)
    seal.add_argument("--out")
    seal.add_argument("--dry-run", action="store_true")
    check = sub.add_parser("check")
    check.add_argument("--snapshot", required=True)
    gate = sub.add_parser("gate-sync")
    gate.add_argument("--snapshot", required=True)
    gate.add_argument("--stamp", required=True)
    args = parser.parse_args(argv)
    try:
        if args.cmd == "seal":
            bundle = json.loads(Path(args.pages).read_text(encoding="utf-8"))
            snapshot = seal_pages(bundle)
            digest = snapshot["integrity"]["rows_sha256"]
            print(json.dumps({
                "ok": True,
                "dry_run": bool(args.dry_run),
                "rows": snapshot["pagination"]["row_count"],
                "rows_sha256": digest,
            }, ensure_ascii=False))
            if not args.dry_run:
                if not args.out:
                    raise GateError("seal 写文件时需要 --out")
                write_json(Path(args.out), snapshot)
            return 0
        if args.cmd == "check":
            snapshot = load_snapshot(Path(args.snapshot))
            print(json.dumps({
                "ok": True,
                "rows": snapshot["pagination"]["row_count"],
                "rows_sha256": snapshot["integrity"]["rows_sha256"],
            }, ensure_ascii=False))
            return 0
        assert_sync_allowed(Path(args.snapshot), Path(args.stamp))
        print("SYNC GATE OK")
        return 0
    except GateError as exc:
        print(f"SYNC GATE FAIL: {exc}" if args.cmd == "gate-sync" else json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
