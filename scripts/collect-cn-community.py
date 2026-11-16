#!/usr/bin/env python3
"""Collect Chinese-community posts (知乎 / 微博 / 即刻 / 豆瓣 / B站, optional 微信) as leads for 社区热帖.

Results are leads only. Each URL is opened with a short curl; if the original cannot be
opened, the row is still written and later import will badge 未查到原文.

Usage:
  # First batch (cap ~50 queries, ~60-80 posts, past ~30 days):
  python3 /workspace/edu-hot/scripts/collect-cn-community.py --seed

  # Daily routine (max 15 queries, after: last 2 days, at most ~20 new posts; skip if nothing new):
  python3 /workspace/edu-hot/scripts/collect-cn-community.py --daily

Do not print DEEPSEEK_API_KEY. Writes /workspace/edu-hot/.data/cn-community-inbox.json (merge, dedupe by URL).
"""
from __future__ import annotations

import argparse, hashlib, html, json, os, re, subprocess, sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse, urlunparse
from urllib.request import Request, urlopen

BJ = timezone(timedelta(hours=8))
REPO = Path(__file__).resolve().parents[1]
INBOX = REPO / ".data" / "cn-community-inbox.json"
CACHE = REPO / ".data" / "cn-community-search-cache.json"
EXISTING_VOICES = REPO / ".data" / "voices.json"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
API = "https://api.deepseek.com/v1/tools/search"

HOST_MAP = (
    (re.compile(r"(^|\.)zhihu\.com$", re.I), "知乎"),
    (re.compile(r"(^|\.)(weibo\.com|weibo\.cn)$", re.I), "微博"),
    (re.compile(r"(^|\.)(okjike\.com|ruguoapp\.com)$", re.I), "即刻"),
    (re.compile(r"(^|\.)douban\.com$", re.I), "豆瓣"),
    (re.compile(r"(^|\.)(bilibili\.com|b23\.tv)$", re.I), "B站"),
    (re.compile(r"(^|\.)mp\.weixin\.qq\.com$", re.I), "微信"),
)

# Only real post URLs, not search / topic / user home / ranking pages.
POST_PATH = {
    "知乎": re.compile(r"/p/\d|/question/\d|/zhuanlan|/pin/\d", re.I),
    "微博": re.compile(r"/(detail|status|ttarticle/.+/id/|s/)|/\d{10,}|weibo\.com/[A-Za-z0-9._-]+/[A-Za-z0-9]+", re.I),
    "即刻": re.compile(r"/(originalPosts?|reposts?)/", re.I),
    "豆瓣": re.compile(r"/(group/topic|topic|note|status|review)/\d", re.I),
    "B站": re.compile(r"/(video/|opus/|read/cv)", re.I),
    "微信": re.compile(r"/s(/|\?)", re.I),
}

SKIP_HOST_PATH = re.compile(
    r"/search|/hot$|/topics/?$|/people/|/campaign|/signin|/login|/explore|/rank|/tardis/|/users/",
    re.I,
)

SEED_QUERIES = [
    'site:zhihu.com AI家教 after:2026-10-11',
    'site:zhihu.com AI作文批改 after:2026-10-11',
    'site:zhihu.com 豆包爱学 after:2026-10-11',
    'site:zhihu.com 作业帮 AI after:2026-10-11',
    'site:zhihu.com 学而思学习机 after:2026-10-11',
    'site:zhihu.com 教师用AI OR 孩子用ChatGPT after:2026-10-11',
    'site:zhihu.com 豆神语文 OR AI口语陪练 after:2026-10-11',
    'site:weibo.com AI家教 OR AI作文 after:2026-10-11',
    'site:weibo.com 豆包爱学 after:2026-10-11',
    'site:weibo.com 作业帮 AI 学习 after:2026-10-11',
    'site:bilibili.com 豆包爱学 after:2026-10-11',
    'site:bilibili.com AI学习机 after:2026-10-11',
    'site:bilibili.com AI作文批改 after:2026-10-11',
    'site:okjike.com AI教育 OR AI家教 after:2026-10-11',
    'site:okjike.com 豆包 学习 after:2026-10-11',
    'site:douban.com AI教育 OR AI作文 after:2026-10-11',
    'site:douban.com 学习机 AI after:2026-10-11',
    'site:zhihu.com 猿辅导 AI OR 有道网课 AI after:2026-10-11',
    'site:bilibili.com 教师 AI 课堂 after:2026-10-11',
    'site:zhihu.com 儿童用AI 担忧 after:2026-10-11',
    'site:zhihu.com 孩子用AI半小时 OR 孩子用豆包 after:2026-10-11',
    'site:zhihu.com AI批改作文 家长 after:2026-10-11',
    'site:zhihu.com 作业帮学习机 体验 after:2026-10-11',
    'site:zhihu.com 学而思学习机 体验 OR 踩坑 after:2026-10-11',
    'site:zhihu.com 小猿学习机 OR 猿辅导学习机 after:2026-10-11',
    'site:zhihu.com 教师备课 AI after:2026-10-11',
    'site:zhihu.com 讯飞学习机 体验 after:2026-10-11',
    'site:zhihu.com AI绘本 OR 口语陪练 after:2026-10-11',
    'site:zhihu.com 豆神语文 OR 叫叫 after:2026-10-11',
    'site:weibo.com 学而思学习机 after:2026-10-11',
    'site:weibo.com 孩子用AI 作业 after:2026-10-11',
    'site:weibo.com 教师 AI 备课 after:2026-10-11',
    'site:weibo.com 家长 AI批改作文 after:2026-10-11',
    'site:weibo.com 豆神 OR 叫叫 语文 after:2026-10-11',
    'site:bilibili.com AI作文 after:2026-10-11',
    'site:bilibili.com 作业帮学习机 体验 after:2026-10-11',
    'site:bilibili.com 学而思学习机 体验 after:2026-10-11',
    'site:bilibili.com 家长 AI辅导 after:2026-10-11',
    'site:bilibili.com 豆包 作业 OR 豆包爱学 after:2026-10-11',
    'site:okjike.com AI老师 OR AI作文 OR 学习机 after:2026-10-11',
    'site:okjike.com ChatGPT 作业 OR 孩子 学习 after:2026-10-11',
    'site:okjike.com 教师 AI after:2026-10-11',
    'site:douban.com/group AI作文 OR ChatGPT 作业 after:2026-10-11',
    'site:douban.com 家长 AI 作业 after:2026-10-11',
    'site:douban.com 豆瓣 AI家教 OR 学习机 after:2026-10-11',
    'site:zhihu.com 有道 AI 学习 OR 有道词典笔 after:2026-10-11',
    'site:weibo.com 作业帮学习机 after:2026-10-11',
    'site:weibo.com 讯飞学习机 after:2026-10-11',
    'site:bilibili.com 小猿学习机 OR 讯飞学习机 体验 after:2026-10-11',
    'site:zhihu.com 儿童 AI 玩具 消协 after:2026-10-11',
]


DAILY_QUERIES = [
    'site:zhihu.com (AI家教 OR AI作文批改 OR 豆包爱学 OR 作业帮AI OR 学而思学习机) after:{after}',
    'site:zhihu.com (教师用AI OR 孩子用ChatGPT OR 孩子用豆包) after:{after}',
    'site:zhihu.com (作业帮学习机 OR 小猿学习机 OR 讯飞学习机 体验) after:{after}',
    'site:zhihu.com (AI绘本 OR 口语陪练 OR 豆神语文) after:{after}',
    'site:weibo.com (AI家教 OR 豆包爱学 OR AI作文) after:{after}',
    'site:weibo.com (学而思学习机 OR 作业帮学习机 OR 孩子用AI) after:{after}',
    'site:weibo.com (教师 AI 备课 OR 家长 AI批改作文) after:{after}',
    'site:bilibili.com (豆包爱学 OR AI学习机 OR AI作文) after:{after}',
    'site:bilibili.com (作业帮学习机 OR 学而思学习机 体验) after:{after}',
    'site:bilibili.com (家长 AI辅导 OR 教师 AI 课堂) after:{after}',
    'site:okjike.com (AI教育 OR AI家教 OR 学习机) after:{after}',
    'site:okjike.com (ChatGPT 作业 OR 教师 AI) after:{after}',
    'site:douban.com (AI教育 OR AI作文 OR 学习机) after:{after}',
    'site:douban.com (家长 AI 作业 OR ChatGPT 作业) after:{after}',
    'site:zhihu.com (儿童用AI 担忧 OR AI玩具) after:{after}',
]

TOPIC_OK = re.compile(
    r"AI|人工智能|大模型|ChatGPT|Claude|Gemini|豆包|作业帮|学而思|好未来|豆神|猿辅导|有道|讯飞|高途|斑马|学习机|家教|作文|批改|口语|陪练|阅读|老师|教师|家长|学生|教育|课堂|辅导",
    re.I,
)
BAD_TITLE = re.compile(r"^(出错啦|页面不存在|404|抱歉|微博分享|安全验证)|出错啦!", re.I)
OFFTOPIC = re.compile(r"美好奇妙夜|免费神器|不踩坑|破解.{0,12}学习机|安装非官方|只换不修|装软件教程|全套资源|课件下载|手机都是豆包|公司准备采购AI|千问办公")
RANKING_DUP = re.compile(r"AI原生App月活|QuestMobile.*月活|月活用户规模居首|豆包断层领先")


def now_bj() -> str:
    return datetime.now(BJ).strftime("%Y-%m-%d %H:%M")


def today() -> date:
    return datetime.now(BJ).date()


def canon_url(url: str) -> str:
    u = (url or "").strip()
    p = urlparse(u)
    host = p.netloc.lower()
    if host.startswith("www."):
        host = host[4:]
    path = re.sub(r"/+$", "", p.path)
    # keep weixin query (s?__biz=...) ; drop tracking otherwise
    query = p.query if "mp.weixin.qq.com" in host else ""
    if "mp.weixin.qq.com" in host:
        # keep essential weixin params
        parts = []
        for kv in p.query.split("&"):
            k = kv.split("=", 1)[0]
            if k in {"__biz", "mid", "idx", "sn", "chksm"} or path.startswith("/s"):
                parts.append(kv)
        # for /s/XXX short links, no query needed
        if path.startswith("/s/") and len(path) > 3:
            query = ""
        else:
            query = "&".join(parts) if parts else p.query
    return urlunparse(("https", host, path, "", query, ""))


def platform_of(url: str) -> str | None:
    host = urlparse(url).netloc.lower()
    if host.startswith("www."):
        host = host[4:]
    for rx, name in HOST_MAP:
        if rx.search(host):
            return name
    return None


def is_post_url(url: str, platform: str) -> bool:
    p = urlparse(url)
    path = p.path or ""
    if SKIP_HOST_PATH.search(path):
        return False
    if platform == "知乎" and re.search(r"/topic/", url):
        return False
    rx = POST_PATH.get(platform)
    if not rx:
        return False
    return bool(rx.search(url))


def parse_day(value: str | None) -> str | None:
    if not value:
        return None
    s = str(value).strip()
    m = re.search(r"(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})", s)
    if m:
        y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
        try:
            return date(y, mo, d).isoformat()
        except ValueError:
            return None
    m = re.search(r"(20\d{2}-\d{2}-\d{2})", s)
    return m.group(1) if m else None


def load_json(path: Path, default):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def existing_urls() -> set[str]:
    urls: set[str] = set()
    inbox = load_json(INBOX, {})
    for it in inbox.get("items") or []:
        if it.get("url"):
            urls.add(canon_url(it["url"]))
    voices = load_json(EXISTING_VOICES, {})
    for it in voices.get("items") or []:
        if it.get("url"):
            urls.add(canon_url(it["url"]))
    return urls


def classify(title: str, summary: str) -> str:
    blob = f"{title} {summary}"
    if re.search(r"官方|品牌号|发布会|产品发布", blob) and re.search(r"作业帮|学而思|豆包|猿辅导|有道|豆神", blob):
        return "官方或品牌号"
    if re.search(r"(我是|作为)?(家长|宝妈|宝爸|妈妈|爸爸|带娃)", blob) or re.search(r"(孩子|儿子|女儿|我家娃).{0,8}(用|问|写|学)", blob):
        return "家长自述"
    if re.search(r"(我是|作为)?(老师|教师|班主任|教研)", blob) or re.search(r"(课堂|备课|批改作业).{0,6}(我|老师)", blob):
        return "教师自述"
    if re.search(r"(我是)?(大学生|高中生|初中生|小学生|研究生)|我(?:在|把).{0,10}(作业|作文|论文)", blob):
        return "学生自述"
    if re.search(r"测评|评测|对比评|深度体验|实测", blob):
        return "KOL 测评"
    if re.search(r"记者|报道|新闻|媒体", blob):
        return "媒体"
    return "身份未确认"


def search(query: str, count: int, cache: dict) -> list[dict]:
    if query in cache and isinstance(cache[query], list):
        print(f"  cache hit: {query}", flush=True)
        return cache[query]
    key = os.environ.get("DEEPSEEK_API_KEY") or ""
    if not key:
        raise SystemExit("DEEPSEEK_API_KEY missing")
    payload = json.dumps({"query": query, "count": count, "need_content": False}).encode()
    req = Request(API, data=payload, headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"})
    with urlopen(req, timeout=60) as resp:
        data = json.load(resp)
    results = data.get("results") or []
    # store a slim cache (no full content)
    slim = []
    for r in results:
        slim.append({
            "title": r.get("title") or "",
            "url": r.get("url") or "",
            "date": r.get("date") or "",
            "snippet": r.get("snippet") or r.get("summary") or "",
            "site_name": r.get("site_name") or "",
        })
    cache[query] = slim
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return slim


def curl_open(url: str, timeout: int = 15) -> tuple[int, str]:
    dest = Path(f"/tmp/cn-comm-{hashlib.sha1(url.encode()).hexdigest()[:12]}.html")
    cmd = [
        "curl", "-sS", "-L", "--max-redirs", "4", "-A", UA, "--max-time", str(timeout),
        "-H", "Accept-Language: zh-CN,zh;q=0.9,en;q=0.8",
        "-o", str(dest), "-w", "%{http_code}", url,
    ]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout + 5)
        code = int((r.stdout or "0").strip() or 0)
    except Exception:
        return 0, ""
    text = dest.read_text("utf-8", "replace") if dest.exists() else ""
    # keep only the head-ish portion in memory for parsing, then delete file
    try:
        dest.unlink(missing_ok=True)
    except Exception:
        pass
    return code, text[:80000]


def extract_meta(page: str) -> dict:
    def og(prop: str) -> str:
        m = re.search(rf'property=["\']og:{prop}["\']\s+content=["\']([^"\']+)', page, re.I)
        if not m:
            m = re.search(rf'content=["\']([^"\']+)["\']\s+property=["\']og:{prop}["\']', page, re.I)
        return html.unescape(m.group(1)).strip() if m else ""
    title = og("title")
    if not title:
        m = re.search(r"<title>([^<]+)", page, re.I)
        title = html.unescape(m.group(1)).strip() if m else ""
    desc = og("description")
    day = None
    for pat in (
        r'property=["\']article:published_time["\']\s+content=["\']([^"\']+)',
        r'itemprop=["\']datePublished["\']\s+content=["\']([^"\']+)',
        r'"datePublished"\s*:\s*"([^"]+)"',
        r'"pubDate"\s*:\s*"([^"]+)"',
        r'"publish_time"\s*:\s*"([^"]+)"',
        r'"ctime"\s*:\s*"?(\d{10,13})',
    ):
        m = re.search(pat, page, re.I)
        if m:
            day = parse_day(m.group(1))
            if not day and m.group(1).isdigit():
                ts = int(m.group(1))
                if ts > 10**12:
                    ts //= 1000
                try:
                    day = datetime.fromtimestamp(ts, BJ).date().isoformat()
                except Exception:
                    day = None
            if day:
                break
    # login / empty walls
    wall = bool(re.search(r"(登录|驗證|验证码|安全验证|验证后查看)", page[:3000])) and "og:title" not in page.lower()
    return {"title": title, "desc": desc, "day": day, "wall": wall}


EDU_SIGNAL = re.compile(
    r"教育|学习机|作业|作文|老师|教师|家长|孩子|学生|课堂|家教|陪练|批改|语文|绘本|口语|学校|备课|辅导|小学|初中|高中|幼儿园|儿童|少年|青少年|教案|课件|教委|教材|特殊教育|思考力|学习平板|伴学|智慧教育|公开课",
)

def looks_relevant(title: str, snippet: str) -> bool:
    blob = f"{title} {snippet}"
    return bool(TOPIC_OK.search(blob) and EDU_SIGNAL.search(blob))


def verify_row(url: str, lead_title: str, lead_date: str | None, snippet: str) -> dict:
    code, page = curl_open(url)
    meta = extract_meta(page) if page else {"title": "", "desc": "", "day": None, "wall": True}
    title = meta["title"] or lead_title
    # drop site suffix noise
    title = re.sub(r"\s*[-_|]\s*(知乎|微博|豆瓣|即刻|哔哩哔哩|bilibili|微信).*$", "", title, flags=re.I).strip() or lead_title
    title = re.sub(r"\s*[-—–]?\s*切换模式\s*$", "", title).strip() or lead_title
    if BAD_TITLE.search(title or "") or BAD_TITLE.search(meta.get("title") or ""):
        title = lead_title
        meta["wall"] = True
    day = meta["day"] or lead_date
    ok = bool(code == 200 and page and title and not meta["wall"] and len(title) >= 4 and not BAD_TITLE.search(title))
    summary = (meta["desc"] or snippet or "").strip()
    summary = re.sub(r"\s+", " ", summary)[:240]
    return {
        "title": title[:180],
        "summary": summary,
        "published_at": day,
        "open_ok": ok,
        "http_code": code,
    }


def merge_inbox(new_items: list[dict]) -> dict:
    box = load_json(INBOX, {"items": []})
    found = {canon_url(it["url"]): it for it in box.get("items") or [] if it.get("url")}
    added = 0
    for it in new_items:
        u = canon_url(it["url"])
        if u not in found:
            added += 1
        found[u] = it
    items = list(found.values())
    items.sort(key=lambda it: (it.get("published_at") or "", it.get("url") or ""), reverse=True)
    catalog = {
        "generatedAt": now_bj(),
        "asOf": today().isoformat(),
        "items": items,
        "counts": {
            "total": len(items),
            "by_platform": {},
            "unverified": sum(1 for i in items if not i.get("open_ok")),
        },
    }
    from collections import Counter
    catalog["counts"]["by_platform"] = dict(Counter(i.get("platform") for i in items))
    INBOX.parent.mkdir(parents=True, exist_ok=True)
    INBOX.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return {"added": added, "total": len(items)}


def collect(queries: list[str], max_queries: int, max_new: int, after: date | None, per_query: int) -> dict:
    cache = load_json(CACHE, {})
    seen = existing_urls()
    new_items: list[dict] = []
    used = 0
    skipped_old = 0
    skipped_not_post = 0
    skipped_irrelevant = 0
    skipped_dup = 0

    for q in queries:
        if used >= max_queries or len(new_items) >= max_new:
            break
        used += 1
        print(f"query {used}/{max_queries}: {q}", flush=True)
        try:
            results = search(q, per_query, cache)
        except Exception as e:
            print(f"  search error: {type(e).__name__}", flush=True)
            continue
        print(f"  hits={len(results)} new_so_far={len(new_items)}", flush=True)
        for r in results:
            if len(new_items) >= max_new:
                break
            url = canon_url(r.get("url") or "")
            if not url:
                continue
            if url in seen:
                skipped_dup += 1
                continue
            plat = platform_of(url)
            if not plat or not is_post_url(url, plat):
                skipped_not_post += 1
                continue
            title = re.sub(r"\s*[-—–]?\s*切换模式\s*$", "", (r.get("title") or "").strip())
            title = re.sub(r"[_|\s]*(哔哩哔哩|bilibili)\s*$", "", title, flags=re.I).strip()
            snippet = (r.get("snippet") or "").strip()
            if not looks_relevant(title, snippet):
                skipped_irrelevant += 1
                continue
            if BAD_TITLE.search(title) or OFFTOPIC.search(title) or OFFTOPIC.search(snippet) or RANKING_DUP.search(title):
                skipped_irrelevant += 1
                continue
            if re.search(r"/ttarticle/p/show/?$", url) and "id/" not in url:
                skipped_not_post += 1
                continue
            lead_date = parse_day(r.get("date"))
            verified = verify_row(url, title, lead_date, snippet)
            day = verified["published_at"]
            if after and day:
                try:
                    if date.fromisoformat(day) < after:
                        skipped_old += 1
                        continue
                except ValueError:
                    pass
            # If we have a parsed date older than 40 days on seed, skip
            item = {
                "platform": plat,
                "url": url,
                "title": verified["title"] or title,
                "summary": verified["summary"] or snippet,
                "author": "",
                "published_at": day,
                "source_label": classify(verified["title"] or title, verified["summary"] or snippet),
                "metrics": {"captured_at": now_bj()},
                "open_ok": verified["open_ok"],
                "origin": "cn-community",
            }
            new_items.append(item)
            seen.add(url)
            flag = "ok" if item["open_ok"] else "未查到原文"
            print(f"  + {plat} {flag} {day or '无日期'} {item['title'][:36]}", flush=True)

    merged = merge_inbox(new_items)
    summary = {
        "queries_used": used,
        "new_posts": len(new_items),
        "inbox_total": merged["total"],
        "skipped_dup": skipped_dup,
        "skipped_not_post": skipped_not_post,
        "skipped_irrelevant": skipped_irrelevant,
        "skipped_old": skipped_old,
        "by_platform": {},
        "unverified_new": sum(1 for i in new_items if not i.get("open_ok")),
    }
    from collections import Counter
    summary["by_platform"] = dict(Counter(i["platform"] for i in new_items))
    print("SUMMARY", json.dumps(summary, ensure_ascii=False), flush=True)
    return summary


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", action="store_true", help="first batch: ~50 queries, ~60-80 posts, past ~30 days")
    ap.add_argument("--daily", action="store_true", help="routine: max 15 queries, last 2 days, ~20 new posts")
    ap.add_argument("--max-queries", type=int)
    ap.add_argument("--max-new", type=int)
    args = ap.parse_args()
    if args.daily:
        after = today() - timedelta(days=2)
        queries = [q.format(after=after.isoformat()) for q in DAILY_QUERIES]
        summary = collect(queries, max_queries=min(args.max_queries or 15, 15), max_new=min(args.max_new or 20, 20), after=after, per_query=8)
        if summary["new_posts"] == 0:
            print("SKIP nothing new", flush=True)
        return
    # seed / first batch
    after = today() - timedelta(days=31)
    summary = collect(
        SEED_QUERIES,
        max_queries=min(args.max_queries or 50, 50),
        max_new=min(args.max_new or 80, 80),
        after=after,
        per_query=8,
    )
    if summary["new_posts"] == 0:
        print("SKIP nothing new", flush=True)


if __name__ == "__main__":
    main()
