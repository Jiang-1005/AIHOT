#!/usr/bin/env python3
"""Import X, 小红书, and Chinese-community voices into the 「社区热帖」 catalog.

Idempotent: dedupes by canonical original-post URL. Does not log into any site.
Admit-all: unverified posts stay in the section with a 未查到原文 badge.

Daily rerun (on the box, Asia/Shanghai):

  python3 /workspace/edu-hot/scripts/import-voices.py

This writes .data/voices.json and, when Docker is available, copies it to the
API volume at /data/voices.json so the live page updates without a restart.
"""
from __future__ import annotations

import argparse, csv, hashlib, html, json, os, re, subprocess, sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse, urlunparse

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from facets import (
    resolve_x_tags, load_bak_tags, display_subject, normalize_tag_set, empty_tags,
    clean_companies,
)


BJ = timezone(timedelta(hours=8))
TODAY = datetime.now(BJ).date()
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
REPO = Path(__file__).resolve().parents[1]

POSTER_X = {
    "家长自述": "家长自述",
    "教师自述": "教师自述",
    "学生自述": "学生自述",
}
# KOL 测评这一版不收进社区热帖。

POSTER_XHS = {
    "家长": "家长自述",
    "教师": "教师自述",
    "大学生": "学生自述",
    "中小学生": "学生自述",
}
# Not admitted: only the parent / teacher / student themselves. No KOL, brands, or institutions.
EXCLUDED_POSTER = {"官方或品牌号", "媒体", "研究或论文", "成人学习者", "教育从业者", "通用"}

# Merchant / course-ad signals in title or points.
AD_RE = re.compile(
    r"(怎么选|避雷|这个价|还能更优惠|双11|双十一|客单价|课程报名|训练营|1v1工作室|学习机|词典笔|众筹价|优惠码|立即购买|报名链接|卖家起量)",
    re.I,
)

# Product launches or selling posts that are not parent/teacher/student voices.
DENY_URLS = {
    "https://x.com/rwayne/status/2119687180188787121",
    "https://x.com/MirrortekUK/status/2118323731671970187",
    "https://x.com/bitbird2014/status/2113186495444267432",
    "https://x.com/vintweeta/status/2119134921294074367",
    "https://x.com/Cyrus9s/status/2119658461822591263",
}

# Verified originals that are institutional / community accounts, not a parent, teacher, or student.
INSTITUTION_URLS = {
    # Family Build：简介自称家庭社群账号，原帖写「经常有家长后台会私信」，不是家长本人自述。
    "https://x.com/FamilyBuildAI/status/2119694935637315764",
}

# Claims of improvement must be labelled 用户自述, never as fact.
CLAIM_RE = re.compile(r"(进步很快|提高了|成绩(升|提高|变好)|效果显著|效果还可以|用了就|提分|进步明显|省出了不少时间|省下不少时间)")


# Cover-title prefixes like「帖主转述媒体报道：」「帖主转述X：」「帖主称：」.
# Starts with 帖主, ends at the first full-width or half-width colon. Source files keep the original wording.
CLAIMER_PREFIX_RE = re.compile(r"^(帖主[^：:\n]{0,40}[：:])")


def strip_claimer_prefix(text: str) -> tuple[str, str | None]:
    """Return (cover_title, kind) where kind is 'self' / 'retold' / None."""
    raw = (text or "").strip()
    m = CLAIMER_PREFIX_RE.match(raw)
    if not m:
        return raw, None
    rest = raw[m.end():].strip()
    if not rest:
        return raw, None
    kind = "self" if "自述" in m.group(1) else "retold"
    return rest, kind


# Same pattern the current voices.tsx uses to decide 转述/自述徽标 and strip the cover title.
# Do not change the frontend; only strip in the catalog when a badge will actually show.
FRONTEND_CLAIMER_RE = re.compile(r"^(帖主(?:转述|自述|介绍|提醒|转发|认为|发布|称))[：:，,\s]*")

# 作文说（@bitbird2014）：用户数已核对，收入数字未核实 → 必须带「未查到原文」徽标。
UNVERIFIED_CLAIM_URLS = {
    "https://x.com/bitbird2014/status/2113186495444267432",
    "https://twitter.com/bitbird2014/status/2113186495444267432",
}


def frontend_claimer_matches(text: str) -> bool:
    raw = (text or "").strip()
    m = FRONTEND_CLAIMER_RE.match(raw)
    if not m:
        return False
    return bool(raw[m.end():].strip())


def claims_unverified(url: str, title: str, brief: str, summary: str) -> bool:
    """Mark posts whose claims the radar flagged as unverified, even if the X URL opens."""
    u = (url or "").split("?")[0].rstrip("/")
    if u in UNVERIFIED_CLAIM_URLS or u.endswith("/bitbird2014/status/2113186495444267432"):
        return True
    return False



def now_bj() -> str:
    return datetime.now(BJ).strftime("%Y-%m-%d %H:%M")


def parse_day(value: str | None) -> date | None:
    if not value:
        return None
    m = re.match(r"(\d{4}-\d{2}-\d{2})", value)
    if not m:
        return None
    try:
        return date.fromisoformat(m.group(1))
    except ValueError:
        return None


def age_days(day: date | None, as_of: date = TODAY) -> int | None:
    if not day:
        return None
    return (as_of - day).days


def slot_of(day: date | None, as_of: date = TODAY) -> str | None:
    a = age_days(day, as_of)
    if a is None or a < 0:
        return None
    if a <= 7:
        return "featured"
    if a <= 30:
        return "archive"
    return None


def extract_url(value) -> str | None:
    if not value:
        return None
    if isinstance(value, list):
        for v in value:
            u = extract_url(v)
            if u:
                return u
        return None
    s = str(value)
    m = re.search(r"https?://[^\s\]）)]+", s)
    return m.group(0).rstrip(").,，。") if m else None


def canon_url(url: str) -> str:
    u = url.strip()
    u = u.replace("https://twitter.com/", "https://x.com/").replace("http://twitter.com/", "https://x.com/")
    u = u.replace("https://www.twitter.com/", "https://x.com/")
    p = urlparse(u)
    host = p.netloc.lower()
    path = re.sub(r"/+$", "", p.path)
    # strip tracking query
    return urlunparse(("https", host, path, "", "", ""))



X_STATUS_RE = re.compile(r"^https://x\.com/[A-Za-z0-9_]{1,15}/status/\d+$", re.I)
X_PROFILE_RE = re.compile(r"^https://x\.com/[A-Za-z0-9_]{1,15}/?$", re.I)
BAK_TAGS_PATH = Path("/workspace/edu-radar/grok-posts.bak-20261110f-tags.json")


def is_x_status_url(url: str) -> bool:
    return bool(X_STATUS_RE.match((url or "").split("?")[0].rstrip("/")))


def coerce_x_status_url(url: str, post: dict | None = None) -> str | None:
    """Only admit a real /status/ URL. Profile URLs are not originals."""
    if not url:
        return None
    u = canon_url(url)
    u = u.replace("https://mobile.x.com/", "https://x.com/").replace("https://www.x.com/", "https://x.com/")
    if is_x_status_url(u):
        return u
    # recover from a status id in the record, if the URL was a profile
    post = post or {}
    sid = post.get("status_id") or post.get("tweet_id") or post.get("id")
    author = (post.get("author") or "").lstrip("@")
    if sid and str(sid).isdigit() and author and not str(sid).startswith("v"):
        cand = f"https://x.com/{author}/status/{sid}"
        if is_x_status_url(cand):
            return cand
    return None

def sha_id(url: str) -> str:
    return "v" + hashlib.sha1(url.encode()).hexdigest()[:16]


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def curl_headers(url: str, follow: bool, timeout: int = 18) -> tuple[int, str, bytes]:
    dest_headers = Path(f"/tmp/voices-headers-{hashlib.sha1(url.encode()).hexdigest()[:10]}.txt")
    dest_body = Path(f"/tmp/voices-body-{hashlib.sha1(url.encode()).hexdigest()[:10]}.bin")
    cmd = ["curl", "-sS", "-A", UA, "--max-time", str(timeout), "-D", str(dest_headers), "-o", str(dest_body),
           "-w", "%{http_code}", "-H", "Accept-Language: zh-CN,zh;q=0.9,en;q=0.8"]
    if follow:
        cmd[2:2] = ["-L", "--max-redirs", "4"]
    else:
        cmd += ["--max-redirs", "0"]
    cmd.append(url)
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout + 5)
        code = int((r.stdout or "0").strip() or 0)
    except Exception:
        return 0, "", b""
    headers = dest_headers.read_text("utf-8", "replace") if dest_headers.exists() else ""
    body = dest_body.read_bytes() if dest_body.exists() else b""
    return code, headers, body


def verify_x(url: str) -> tuple[bool, str]:
    """Open the original tweet. 200 plus the post's own title/description counts as verified.
    A login shell with no post text does not."""
    code, headers, body = curl_headers(url, follow=True)
    if code != 200 or not body:
        return False, "未查到原文"
    text = body.decode("utf-8", "replace")
    # Must be the same status, not a generic login or error page.
    status = re.search(r"/status/(\d+)", url)
    if status and status.group(1) not in text:
        return False, "未查到原文"
    desc = ""
    m = re.search(r'property="og:description"\s+content="([^"]*)"', text)
    if m:
        desc = html.unescape(m.group(1))
    title = ""
    m = re.search(r"<title>([^<]+)", text)
    if m:
        title = html.unescape(m.group(1))
    if len(desc.strip()) >= 20 or ("on X" in title and len(title) > 30):
        return True, "ok"
    if "Log in" in text and len(desc.strip()) < 20:
        return False, "未查到原文"
    return False, "未查到原文"


def verify_xhs(url: str) -> tuple[bool, str]:
    """Do not log in. 小红书 typically redirects to a login or unavailable page from this environment."""
    code, headers, body = curl_headers(url, follow=False)
    loc = ""
    for line in headers.splitlines():
        if line.lower().startswith("location:"):
            loc = line.split(":", 1)[1].strip()
    if code in (401, 403, 404, 302, 301, 0):
        return False, "未查到原文"
    if code == 200 and body:
        text = body.decode("utf-8", "replace")
        # A real note page has the note id and article-like og tags, not a login wall only.
        note_id = url.rstrip("/").rsplit("/", 1)[-1]
        if note_id and note_id in text and "og:description" in text and "登录" not in text[:2000]:
            return True, "ok"
    return False, "未查到原文"


_KIN_NAME_STOP = {
    "的", "在", "是", "有", "和", "与", "用", "把", "被", "给", "让", "对", "跟", "从", "到",
    "也", "还", "就", "都", "很", "不", "没", "要", "能", "会", "去", "来", "看", "听", "说",
    "学", "读", "写", "做", "玩", "买", "选", "找", "带", "帮", "为", "向", "比", "再", "才",
    "已", "却", "但", "这", "那", "使用", "真正", "实际", "逐渐", "怎么", "如何", "可以",
    "需要", "开始", "告别", "识字", "阅读", "英语", "作业", "辅导", "偷偷", "用来", "自建",
}

def _looks_like_given_name(token: str) -> bool:
    if not token or token in _KIN_NAME_STOP or token[0] in "的在是有和与用把被给让对跟从到也还就都很不没要能会":
        return False
    return True

def sanitize(text: str) -> str:
    if not text:
        return text
    s = text
    # Drop children's given names. Do not rewrite 中学生/小学生, 孩子用/孩子使用, or generic policy language.
    def drop_kin_name(m: re.Match) -> str:
        return m.group(1) if _looks_like_given_name(m.group(2)) else m.group(0)
    s = re.sub(r"(女儿|儿子|孩子|小孩)([A-Za-z][A-Za-z.\-]{0,20}|[\u4e00-\u9fff]{1,2})(?=[，。、！？\s]|$)", drop_kin_name, s)
    s = re.sub(r"上 Alpha School 后", "进入一所主打 AI 授课的学校后", s)
    s = re.sub(r"首家 Alpha School", "一家主打 AI 授课的学校", s)
    s = re.sub(r"\bAlpha School\b", "一所主打 AI 授课的学校", s)
    s = re.sub(r"孩子\s*一所主打 AI 授课的学校\s*后", "孩子进入一所主打 AI 授课的学校后", s)
    # Only rewrite clearly named 小学/附中/幼儿园, never 中小学/中学生/国家中小学智慧教育平台.
    def school_repl(m: re.Match) -> str:
        raw = m.group(0)
        # 国家中小学 / 中小学生 are generic; "附中小学" still counts as a named school.
        if re.search(r"国家中小学|(?<![附])中小学|小学生|中学生|初中生|高中生|幼儿园到|小学至|幼小初高", raw):
            return raw
        return "某" + (m.group(2) or "学校")
    s = re.sub(r"(?<![大中小初高幼])(?:(?![在去读上于到进的和与])[\u4e00-\u9fff]){2,8}(附属)?(小学|附中|幼儿园)(?!生)", school_repl, s)
    return s.strip()


def mark_claims(text: str) -> str:
    if not text:
        return text
    if CLAIM_RE.search(text) and "用户自述" not in text:
        return "【用户自述】" + text
    return text


def why_xintian(platform: str, poster: str, title: str, summary: str) -> str | None:
    """One-line note on why this matters to the product. None = not relevant enough to admit."""
    blob = f"{title} {summary}"
    # Direct product themes: 情商语文 / 读写表达 / 精批精改 / 引导式陪练 / 不直接给答案 / 校内 AI 开关 / 儿童安全
    rules = [
        (r"默认(关闭|开启).*(Gemini|AI)|开搜索就必须|不给关闭|关闭选项|学校.*AI.*(捆绑|开关|默认)",
         "校内 AI 默认开关和捆绑，是讨论「先由大人打开」时必须对照的真实场景。"),
        (r"作文|写作|润色|批改|精批|读写|语文老师",
         "直接碰到作文批改和孩子自己动笔的边界，对精批精改和读写陪练是对照样本。"),
        (r"不(直接)?给答案|只给提示|苏格拉底|引导式|找错",
         "「不直接给答案、带着孩子想」是陪练要守住的方法，这条可作设计对照。"),
        (r"纸质课本|手写|数字化回撤|退回纸质",
         "有的学校在把数字化往回撤，提醒产品不要把陪练做成「离开屏幕就不会学」。"),
        (r"(成绩|考试).*(变差|下降|降)|练习用 AI.*撤掉|写(作)?却变差|像同一个人写",
         "用 AI 代写或代练后，一离开模型表现下滑——是要避免的结果，不是成绩卖点。"),
        (r"情商|对话与情商|表达|不敢.*发言|社会情感",
         "情商和表达是主线，这类一线观察可作课程和陪练的参考。"),
        (r"毛绒|陪伴玩具|危险(话语|发言)|假装真人|儿科医生|知情(同意|争议)",
         "儿童向 AI 的安全和知情同意，是做陪练时必须对齐的底线。"),
        (r"AI 素养|三个维度",
         "把 AI 素养拆成可教的维度，对设计家长和孩子都能用的说明有参考价值。"),
        (r"暂停 AI 家教|呼吁暂停",
         "家长和公众对 AI 家教试点的保留态度，提醒产品不要把陪练做成无人看管的家教。"),
        (r"学生作弊是考试失效|考试失效的信号",
         "把作弊看成原有考核失效，而不是只怪学生——对怎么设计练习和反馈有启发。"),
        (r"下一篇能自己写|AI 辅助创作作文",
         "用过 AI 之后还能不能自己写，是读写陪练要回答的问题。"),
        (r"教师.*(写作反馈|读写教研)|课堂点子",
         "教师怎么用 AI 做写作反馈，对把教研方法写成可执行的陪练有用。"),
        (r"Alpha School|主打 AI 授课|上.*学校后的意外",
         "家长讲述孩子进入 AI 授课学校后的感受，可作方向对照，不当成效果证明。"),
        (r"故事创作|儿童故事",
         "孩子用 AI 做故事，和表达、创作练习相邻，需标成用户体验而非效果承诺。"),
        (r"Grok Bot.*作文|辅导孩子作文",
         "家长已经在用对话式工具陪孩子写作，是陪练要面对的真实用法。"),
        (r"问豆包|抄答案|只讲题不给答案",
         "孩子用通用模型抄答案、家长和老师怎么接住，是作业场景里要处理的问题。"),
        (r"错题本|作业辅导",
         "家长用 AI 整理错题或辅导作业，可作场景参考，但效果只能标成用户自述。"),
        (r"笔记做成|交互网站",
         "学生把自己的笔记做成可复习的东西，是主动学习而不是代写，对表达和复习设计有启发。"),
        (r"给 .{0,6}孩子上|上课的复盘|两天 AI",
         "教师带孩子短期用 AI 做项目的复盘，可看课堂里真正发生了什么。"),
    ]
    for pat, note in rules:
        if re.search(pat, blob, re.I):
            return note
    return None


def is_ad(title: str, summary: str, content_type=None) -> bool:
    if content_type:
        types = content_type if isinstance(content_type, list) else [content_type]
        if any(t in {"选购讨论"} for t in types):
            return True
    return bool(AD_RE.search(title or "") or AD_RE.search(summary or ""))


# --- source loaders ---

def load_x(path: Path) -> list[dict]:
    data = load_json(path)
    posts = data["posts"] if isinstance(data, dict) else data
    out = []
    for p in posts:
        raw_url = p.get("url")
        if not raw_url:
            continue
        url = coerce_x_status_url(raw_url, p)
        if not url:
            # keep the row so it can be rejected as 未查到原文
            url = canon_url(raw_url)
            status_ok = False
        else:
            status_ok = True
        metrics = p.get("metrics") or {}
        out.append({
            "platform": "X",
            "url": url,
            "title": p.get("title") or "",
            "summary": p.get("summary") or "",
            "author": p.get("author") or "",
            "published_at": p.get("published_at"),
            "day": parse_day(p.get("published_at")),
            "source_label": p.get("source") or "",
            "poster": POSTER_X.get(p.get("source") or "", None),
            "age_range": p.get("age_raw") or ("、".join(p.get("age_group") or []) if p.get("age_group") else "未标注"),
            "country": "、".join(p.get("country") or []) or "未标注",
            "brief": (p.get("brief") or "").strip(),
            "metrics": {
                "likes": metrics.get("likes"),
                "reposts": metrics.get("reposts"),
                "replies": metrics.get("replies"),
                "quotes": metrics.get("quotes"),
                "bookmarks": metrics.get("bookmarks"),
                "views": metrics.get("views"),
                "captured_at": metrics.get("captured_at"),
                "metrics_fetched_at": p.get("metrics_fetched_at") or metrics.get("metrics_fetched_at"),
            },
            "origin": str(path),
            "status_ok": status_ok,
            "topic": p.get("topic"),
            "subject": p.get("subject"),
            "companies": p.get("companies"),
            "form": p.get("form"),
            "content_type": p.get("content_type"),
            "raw_post": p,
        })
    return out


def load_xhs_table(path: Path) -> list[dict]:
    data = load_json(path)
    payload = data.get("data") or {}
    fields = payload.get("fields") or []
    if "原帖" not in fields or "笔记标题" not in fields:
        return []  # aggregate tables, not notes
    rows = []
    for rec in payload.get("data") or []:
        row = dict(zip(fields, rec))
        url = extract_url(row.get("原帖"))
        if not url:
            continue
        url = canon_url(url)
        crowd = row.get("人群")
        if isinstance(crowd, list):
            crowd = crowd[0] if crowd else ""
        status = row.get("核验状态")
        if isinstance(status, list):
            status = status[0] if status else ""
        likes, collects, comments = row.get("点赞"), row.get("收藏"), row.get("评论")
        captured = row.get("采集日期") or row.get("页面时间")
        rows.append({
            "platform": "小红书",
            "url": url,
            "title": row.get("笔记标题") or "",
            "summary": row.get("讨论要点") or "",
            "author": row.get("作者") or "",
            "published_at": row.get("发布日期"),
            "day": parse_day(row.get("发布日期") or row.get("页面时间")),
            "source_label": crowd or "",
            "poster": POSTER_XHS.get(crowd or "", None),
            "age_range": row.get("学生年龄段") or "未标注",
            "country": row.get("国家") or "中国",
            "content_type": row.get("内容类型"),
            "xhs_status": status,
            "metrics": {
                "likes": likes,
                "collects": collects,
                "comments": comments,
                "captured_at": captured,
                "caption": row.get("互动口径") or None,
            },
            "origin": str(path),
        })
    return rows


def load_xhs_csv(path: Path) -> list[dict]:
    if not path.exists():
        return []
    text = path.read_text(encoding="utf-8-sig")
    rows = list(csv.DictReader(text.splitlines()))
    out = []
    for row in rows:
        url = extract_url(row.get("原帖"))
        if not url:
            continue
        url = canon_url(url)
        crowd = (row.get("人群") or "").strip()
        out.append({
            "platform": "小红书",
            "url": url,
            "title": row.get("笔记标题") or "",
            "summary": row.get("讨论要点") or "",
            "author": row.get("作者") or "",
            "published_at": row.get("发布日期"),
            "day": parse_day(row.get("发布日期") or row.get("页面时间")),
            "source_label": crowd,
            "poster": POSTER_XHS.get(crowd, None),
            "age_range": row.get("学生年龄段") or "未标注",
            "country": row.get("国家") or "中国",
            "content_type": row.get("内容类型"),
            "xhs_status": row.get("核验状态") or "",
            "metrics": {
                "likes": row.get("点赞") or None,
                "collects": row.get("收藏") or None,
                "comments": row.get("评论") or None,
                "captured_at": row.get("采集日期") or row.get("页面时间"),
            },
            "origin": str(path),
        })
    return out


def load_xhs_scrub_map() -> dict[str, dict]:
    path = Path("/workspace/edu-hot/.data/xhs-scrubbed.json")
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return {it["url"]: it for it in data.get("items") or [] if it.get("url")}


def apply_xhs_privacy(row: dict, scrub_map: dict[str, dict] | None = None) -> dict:
    """Site-facing 小红书 rows: only scrubbed title + summary + link, never images or author."""
    row = dict(row)
    row.pop("image", None)
    row.pop("images", None)
    row.pop("cover", None)
    overlay = (scrub_map or {}).get(row.get("url") or "")
    if overlay:
        if overlay.get("title"):
            row["title"] = overlay["title"]
        if overlay.get("summary"):
            row["summary"] = overlay["summary"]
    else:
        row["title"] = sanitize(row.get("title") or "")
        row["summary"] = sanitize(row.get("summary") or "")
    return row



CN_PLATFORMS = {"知乎", "微博", "即刻", "豆瓣", "B站", "微信"}
CN_HOST = (
    (re.compile(r"(^|\.)zhihu\.com$", re.I), "知乎"),
    (re.compile(r"(^|\.)(weibo\.com|weibo\.cn)$", re.I), "微博"),
    (re.compile(r"(^|\.)(okjike\.com|ruguoapp\.com)$", re.I), "即刻"),
    (re.compile(r"(^|\.)douban\.com$", re.I), "豆瓣"),
    (re.compile(r"(^|\.)(bilibili\.com|b23\.tv)$", re.I), "B站"),
    (re.compile(r"(^|\.)mp\.weixin\.qq\.com$", re.I), "微信"),
)


def platform_from_url(url: str) -> str | None:
    host = urlparse(url).netloc.lower()
    if host.startswith("www."):
        host = host[4:]
    for rx, name in CN_HOST:
        if rx.search(host):
            return name
    return None


def load_cn_community(path: Path) -> list[dict]:
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return []
    rows = []
    items = data.get("items") if isinstance(data, dict) else data
    for raw in items or []:
        url = extract_url(raw.get("url") or raw.get("原帖"))
        if not url:
            continue
        url = canon_url(url)
        platform = (raw.get("platform") or platform_from_url(url) or "").strip()
        if platform not in CN_PLATFORMS:
            continue
        crowd = (raw.get("source_label") or raw.get("人群") or raw.get("source") or "").strip()
        metrics = raw.get("metrics") if isinstance(raw.get("metrics"), dict) else {}
        rows.append({
            "platform": platform,
            "url": url,
            "title": raw.get("title") or raw.get("笔记标题") or "",
            "summary": raw.get("summary") or raw.get("讨论要点") or "",
            "author": "",
            "published_at": raw.get("published_at") or raw.get("发布日期"),
            "day": parse_day(raw.get("published_at") or raw.get("发布日期") or raw.get("day")),
            "source_label": crowd,
            "poster": POSTER_XHS.get(crowd, crowd or None),
            "age_range": raw.get("age_range") or "未标注",
            "country": raw.get("country") or "中国",
            "metrics": {
                "likes": metrics.get("likes") or raw.get("点赞"),
                "collects": metrics.get("collects") or raw.get("收藏"),
                "comments": metrics.get("comments") or raw.get("评论"),
                "captured_at": metrics.get("captured_at") or raw.get("采集日期") or now_bj(),
            },
            "origin": str(path),
            "open_ok_hint": raw.get("open_ok"),
        })
    # dedupe within file
    found = {}
    for row in rows:
        found[row["url"]] = row
    return list(found.values())


def verify_cn(url: str) -> tuple[bool, str]:
    """Lightweight original-page check: HTTP 200 plus a title, no login wall."""
    code, headers, body = curl_headers(url, follow=True, timeout=15)
    if code != 200 or not body:
        return False, "未查到原文"
    text = body.decode("utf-8", "replace")
    low = text[:4000].lower()
    title = ""
    m = re.search(r'property="og:title"\s+content="([^"]*)"', text, re.I)
    if m:
        title = html.unescape(m.group(1)).strip()
    if not title:
        m = re.search(r"<title>([^<]+)", text, re.I)
        title = html.unescape(m.group(1)).strip() if m else ""
    if re.search(r"(登录|驗證|验证码|安全验证)", text[:3000]) and "og:title" not in low:
        return False, "未查到原文"
    if len(title) >= 4:
        return True, "ok"
    return False, "未查到原文"


def load_all_xhs(directory: Path) -> list[dict]:
    found: dict[str, dict] = {}
    # Notes tables first, then inbox rows (inbox can add new URLs).
    for path in sorted(directory.glob("xhs-*.json")):
        for row in load_xhs_table(path):
            found[row["url"]] = row
    csv_path = directory / "xhs-inbox.csv"
    for row in load_xhs_csv(csv_path):
        found[row["url"]] = row  # inbox wins on the same URL (newer row)
    return list(found.values())


def reject(row: dict, reason: str, rejected: dict):
    rejected.setdefault(reason, []).append(row["url"])


def source_badge(row: dict) -> str:
    """来源 badge: X uses the radar `source` field; 小红书 uses 人群, mapped when we have a standard label."""
    label = (row.get("source_label") or "").strip()
    if not label or label in {"身份未确认", "身份不明"}:
        return "身份未确认"
    if row.get("platform") == "小红书" or row.get("platform") in CN_PLATFORMS:
        return POSTER_XHS.get(label, label or "身份未确认")
    return label


def decide(row: dict, verified: bool, rejected: dict) -> dict | None:
    # Admit-all: keep the row and badge 未查到原文 / 身份未确认 instead of dropping it.
    raw_title = row["title"] or ""
    raw_summary = row["summary"] or ""
    why = why_xintian(row["platform"], row.get("poster") or "", raw_title, raw_summary) or ""
    title = sanitize(raw_title)
    summary = mark_claims(sanitize(raw_summary))
    if re.search(r"成绩高|低 17%|降约", title) and "研究" in (title + raw_summary):
        title = "【研究转述】" + title
    brief = (row.get("brief") or "").strip()
    day = row["day"]
    slot = slot_of(day) or "archive"
    metrics = row.get("metrics") or {}
    captured = metrics.get("captured_at")
    if captured and not str(captured).endswith(("Z", "+08:00")) and re.match(r"\d{4}-\d{2}-\d{2}T", str(captured) or ""):
        captured = str(captured)
    source = source_badge(row)
    identity_unconfirmed = source == "身份未确认" or bool(row.get("identity_unconfirmed"))
    status_ok = True if row.get("platform") != "X" else bool(row.get("status_ok", is_x_status_url(row.get("url") or "")))
    verified_ok = bool(verified) and status_ok
    if claims_unverified(row.get("url") or "", title, brief, summary):
        verified_ok = False
    # Cover title = brief || title, same as voices.tsx. Only strip a 帖主…： prefix when
    # the card will show 未查到原文 or 转述/自述. If the current frontend already strips
    # that prefix, leave it in the catalog so the badge still appears. If it will not
    # (e.g. 「帖主转述媒体报道：」) but 未查到原文 will show, strip here.
    cover_src = brief or title
    has_unverified_badge = not verified_ok
    has_claim_badge = verified_ok and frontend_claimer_matches(cover_src)
    cover_title, kind = strip_claimer_prefix(cover_src)
    if kind and has_unverified_badge:
        # Card will show 未查到原文. Write a fully cleaned cover title: the current
        # frontend regex would only peel off「帖主转述」and leave「媒体报道：…」.
        if brief:
            brief = cover_title
        else:
            title = cover_title
    elif kind and has_claim_badge:
        # Keep the recognized prefix in the catalog so voices.tsx can show 转述/自述 and strip it.
        pass
    else:
        # No badge: keep the prefix on the cover.
        cover_title = cover_src
    claimer_kind = kind if (has_unverified_badge or has_claim_badge) else None
    poster = row.get("poster") or source
    is_cn = row.get("platform") == "小红书" or row.get("platform") in CN_PLATFORMS
    quote = summary if is_cn else (summary[:180] if summary else "")
    return {
        "id": sha_id(row["url"]),
        "platform": row["platform"],
        "url": row["url"],
        "author": "" if is_cn else (row.get("author") or ""),
        "poster": poster,
        "source": source,
        "published_at": row.get("published_at"),
        "day": day.isoformat() if day else None,
        "slot": slot,
        "age_days": age_days(day),
        "age_range": row.get("age_range") or "未标注",
        "country": row.get("country") or "未标注",
        "metrics": metrics,
        "title": title,
        "brief": brief,
        "cover_title": cover_title,
        "claimer_kind": claimer_kind,
        "quote": quote,
        "summary": summary,
        "why": why,
        "verified": verified_ok,
        "unverified_label": None if verified_ok else "未查到原文",
        "identity_unconfirmed": identity_unconfirmed,
        "tags": row.get("tags") or empty_tags(),
        "tags_source": row.get("tags_source"),
    }


def count_report(total: int, verified_n: int, admitted: list, rejected: dict) -> dict:
    from collections import Counter
    return {
        "total": total,
        "verified": verified_n,
        "admitted": len(admitted),
        "unverified": sum(1 for i in admitted if not i.get("verified")),
        "by_source": dict(Counter(i.get("source") or "身份未确认" for i in admitted)),
        "rejected": {k: len(v) for k, v in sorted(rejected.items(), key=lambda kv: -len(kv[1]))},
    }


def main():
    ap = argparse.ArgumentParser(description="Import X / 小红书 / 中文社区 voices (idempotent, no login).")
    ap.add_argument("--x", default="/workspace/edu-radar/grok-posts.json")
    ap.add_argument("--xhs-dir", default="/workspace/research/feishu-edu")
    ap.add_argument("--cn", default=str(REPO / ".data" / "cn-community-inbox.json"))
    ap.add_argument("--out", default=str(REPO / ".data" / "voices.json"))
    ap.add_argument("--report", default=str(REPO / ".data" / "voices-import-report.json"))
    ap.add_argument("--skip-verify", action="store_true", help="dev only")
    args = ap.parse_args()

    x_posts = load_x(Path(args.x))
    xhs_posts = [apply_xhs_privacy(r, load_xhs_scrub_map()) for r in load_all_xhs(Path(args.xhs_dir))]
    cn_posts = load_cn_community(Path(args.cn))
    for row in cn_posts:
        row["title"] = sanitize(row.get("title") or "")
        row["summary"] = sanitize(row.get("summary") or "")
        row["author"] = ""
    bak_by_url = load_bak_tags(BAK_TAGS_PATH)
    x_need_deepseek = []
    for row in x_posts:
        tags, src = resolve_x_tags(row.get("raw_post") or row, bak_by_url)
        if tags:
            # display rule: 政策/融资/泛 AI + 全科通用 → 不涉及 (topic in 政策与合规/公司与资本/观点与趋势)
            tags["subject"] = display_subject(tags.get("topic"), tags.get("subject_raw") or tags.get("subject"))
            tags["companies"] = clean_companies(tags.get("companies"))
            row["tags"] = tags
            row["tags_source"] = src
        else:
            row["tags"] = empty_tags()
            row["tags_source"] = None
            x_need_deepseek.append(row)
    # 小红书: use precomputed content-tags.json if present; otherwise leave empty for tag-content.py
    tag_store_path = REPO / ".data" / "content-tags.json"
    tag_store = {}
    if tag_store_path.exists():
        try:
            tag_store = json.loads(tag_store_path.read_text()).get("items") or {}
        except Exception:
            tag_store = {}
    for row in xhs_posts:
        rec = tag_store.get(row["url"]) or tag_store.get((row.get("url") or "").rstrip("/"))
        if rec and rec.get("topic"):
            row["tags"] = normalize_tag_set(rec) or empty_tags()
            row["tags_source"] = rec.get("source") or "deepseek"
        else:
            row["tags"] = empty_tags()
            row["tags_source"] = None
    print(f"loaded X={len(x_posts)} 小红书={len(xhs_posts)} 中文社区={len(cn_posts)} as_of={TODAY.isoformat()} X_untagged={len(x_need_deepseek)}", flush=True)
    if x_need_deepseek:
        print("X posts without radar/bak tags (will stay 待定 until DeepSeek backfill):", len(x_need_deepseek), flush=True)

    # Verify
    x_verdict: dict[str, tuple[bool, str]] = {}
    xhs_verdict: dict[str, tuple[bool, str]] = {}
    cn_verdict: dict[str, tuple[bool, str]] = {}
    cache_path = REPO / ".data" / "voices-verify-cache.json"
    cache = {}
    if cache_path.exists():
        try:
            cache = json.loads(cache_path.read_text())
        except Exception:
            cache = {}
    if not args.skip_verify:
        x_verdict = {u: (bool(v[0]), v[1]) for u, v in cache.get("X", {}).items() if u in {p["url"] for p in x_posts}}
        xhs_verdict = {u: (bool(v[0]), v[1]) for u, v in cache.get("小红书", {}).items() if u in {p["url"] for p in xhs_posts}}
        cn_verdict = {u: (bool(v[0]), v[1]) for u, v in cache.get("中文社区", {}).items() if u in {p["url"] for p in cn_posts}}
        # Prefer a fresh open_ok hint from the collector for URLs not yet cached.
        for row in cn_posts:
            if row["url"] not in cn_verdict and row.get("open_ok_hint") is True:
                cn_verdict[row["url"]] = (True, "ok")
        x_need = [p["url"] for p in x_posts if p["url"] not in x_verdict]
        xhs_need = [p["url"] for p in xhs_posts if p["url"] not in xhs_verdict]
        print(f"verify cache hit X={len(x_posts)-len(x_need)}/{len(x_posts)} 小红书={len(xhs_posts)-len(xhs_need)}/{len(xhs_posts)}", flush=True)
        with ThreadPoolExecutor(max_workers=8) as pool:
            futs = {pool.submit(verify_x, url): url for url in x_need}
            for i, fut in enumerate(as_completed(futs), 1):
                url = futs[fut]
                try:
                    x_verdict[url] = fut.result()
                except Exception:
                    x_verdict[url] = (False, "未查到原文")
                if i % 20 == 0 or i == len(futs):
                    print(f"  verified X {i}/{len(futs)}", flush=True)
        with ThreadPoolExecutor(max_workers=6) as pool:
            futs = {pool.submit(verify_xhs, url): url for url in xhs_need}
            for i, fut in enumerate(as_completed(futs), 1):
                url = futs[fut]
                try:
                    xhs_verdict[url] = fut.result()
                except Exception:
                    xhs_verdict[url] = (False, "未查到原文")
                if i % 30 == 0 or i == len(futs):
                    print(f"  checked 小红书 {i}/{len(futs)}", flush=True)
        cn_need = [p["url"] for p in cn_posts if p["url"] not in cn_verdict]
        print(f"verify cache hit 中文社区={len(cn_posts)-len(cn_need)}/{len(cn_posts)}", flush=True)
        with ThreadPoolExecutor(max_workers=6) as pool:
            futs = {pool.submit(verify_cn, url): url for url in cn_need}
            for i, fut in enumerate(as_completed(futs), 1):
                url = futs[fut]
                try:
                    cn_verdict[url] = fut.result()
                except Exception:
                    cn_verdict[url] = (False, "未查到原文")
                if i % 20 == 0 or i == len(futs):
                    print(f"  checked 中文社区 {i}/{len(futs)}", flush=True)
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(json.dumps({"X": x_verdict, "小红书": xhs_verdict, "中文社区": cn_verdict}, ensure_ascii=False, indent=2))
    else:
        x_verdict = {p["url"]: (True, "ok") for p in x_posts}
        xhs_verdict = {p["url"]: (False, "未查到原文") for p in xhs_posts}
        cn_verdict = {p["url"]: (False, "未查到原文") for p in cn_posts}

    def run(rows, verdicts):
        admitted, rejected = [], {}
        verified_n = 0
        seen = set()
        for row in rows:
            if row["url"] in seen:
                reject(row, "重复 URL", rejected)
                continue
            seen.add(row["url"])
            ok, _ = verdicts.get(row["url"], (False, "未查到原文"))
            if ok:
                verified_n += 1
            item = decide(row, ok, rejected)
            if item:
                admitted.append(item)
        admitted.sort(key=lambda it: (0 if it["slot"] == "featured" else 1, it.get("day") or "", it["id"]), reverse=True)
        # sort featured first then by day desc — the reverse above messes featured/archive.
        admitted.sort(key=lambda it: (0 if it["slot"] == "featured" else 1, it.get("day") or ""), reverse=False)
        admitted.sort(key=lambda it: ((0 if it["slot"] == "featured" else 1), -(age_days(parse_day(it.get("day"))) or 0) if False else 0, it.get("day") or ""), reverse=False)
        admitted.sort(key=lambda it: (0 if it["slot"] == "featured" else 1, it.get("day") or ""), reverse=True)
        return admitted, rejected, verified_n

    x_adm, x_rej, x_ver = run(x_posts, x_verdict)
    xhs_adm, xhs_rej, xhs_ver = run(xhs_posts, xhs_verdict)
    cn_adm, cn_rej, cn_ver = run(cn_posts, cn_verdict)

    def likes_of(it):
        try:
            return int(str((it.get("metrics") or {}).get("likes") or 0).replace(",", "") or 0)
        except Exception:
            return 0

    def published_key(it):
        return it.get("published_at") or it.get("day") or ""

    items = x_adm + xhs_adm + cn_adm
    # Global URL dedupe across platforms; first occurrence wins (X, then 小红书, then 中文社区).
    deduped, seen_all = [], set()
    for it in items:
        if it["url"] in seen_all:
            continue
        seen_all.add(it["url"])
        deduped.append(it)
    items = deduped
    # Default catalog order = 最新: calendar day desc, same-day by likes desc, then timestamp.
    items.sort(key=lambda it: (it.get("day") or "", likes_of(it), published_key(it), it["id"]), reverse=True)
    featured = [i for i in items if i["slot"] == "featured"]
    archive = [i for i in items if i["slot"] == "archive"]

    catalog = {
        "generatedAt": now_bj(),
        "asOf": TODAY.isoformat(),
        "section": "社区热帖",
        "items": items,
        "counts": {
            "featured": len(featured),
            "archive": len(archive),
            "total": len(items),
            "by_platform": {k: sum(1 for i in items if i["platform"] == k) for k in sorted({i["platform"] for i in items})},
            "by_source": {k: sum(1 for i in items if i.get("source") == k) for k in sorted({i.get("source") or "身份未确认" for i in items})},
        },
        "report": {
            "X": count_report(len(x_posts), x_ver, x_adm, x_rej),
            "小红书": count_report(len(xhs_posts), xhs_ver, xhs_adm, xhs_rej),
            "中文社区": count_report(len(cn_posts), cn_ver, cn_adm, cn_rej),
        },
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n")
    report = {
        "generatedAt": catalog["generatedAt"],
        "asOf": catalog["asOf"],
        "report": catalog["report"],
        "admitted": [{"platform": i["platform"], "slot": i["slot"], "source": i.get("source"), "poster": i["poster"], "verified": i.get("verified"), "day": i["day"], "title": i["title"], "url": i["url"]} for i in items],
        "rejected": {
            "X": {k: v for k, v in x_rej.items()},
            "小红书": {k: v for k, v in xhs_rej.items()},
            "中文社区": {k: v for k, v in cn_rej.items()},
        },
    }
    Path(args.report).write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print("WROTE", out, "featured", len(featured), "archive", len(archive))
    print(json.dumps(catalog["report"], ensure_ascii=False, indent=2))

    # Copy into the API data volume when Docker is up, so /api/site/voices sees it.
    host = os.environ.get("DOCKER_HOST", "tcp://127.0.0.1:2375")
    try:
        subprocess.run(
            ["docker", "cp", str(out), "xintian-edu-hot-api-1:/data/voices.json"],
            check=True, capture_output=True, text=True, env={**os.environ, "DOCKER_HOST": host},
        )
        print("copied to xintian-edu-hot-api-1:/data/voices.json")
    except Exception as e:
        print("docker cp skipped:", e, file=sys.stderr)


if __name__ == "__main__":
    main()
