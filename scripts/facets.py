"""Shared vocabulary and tag helpers for 社区热帖 / 媒体文章 (taxonomy.md 2026-11-10)."""
from __future__ import annotations

import csv
import json
import re
from pathlib import Path

TOPICS = ["公司与资本", "产品与功能", "政策与合规", "研究与证据", "教学实践", "观点与趋势"]
SUBJECTS = ["表达与口语", "阅读写作", "绘本伴读", "情商与SEL", "英语", "数理与提分", "全科通用", "不涉及"]
FORMS = ["App与网页", "大模型学习模式", "教师工具与平台", "学习机与平板", "词典笔与点读绘本机", "AI玩具与陪伴设备", "服务（线下或真人+AI）", "不涉及"]
CONTENT_TYPES = ["新闻快讯", "官方发布", "深度分析", "测评体验", "研究报告", "观点评论", "教程与提示词", "用户自述"]

# 政策 / 融资 / 泛 AI 且上游仍写「全科通用」时，仅在这些主题下显示为「不涉及」。
SUBJECT_OVERRIDE_TOPICS = {"政策与合规", "公司与资本", "观点与趋势"}

NONE_COMPANY = {"不涉及", "未查到", "待定", ""}

# 头部公司必须出现在筛选里（即使暂无内容）。
HEAD_COMPANIES = [
    "好未来",
    "学而思",
    "新东方",
    "猿辅导",
    "作业帮",
    "有道",
    "讯飞",
    "高途",
    "豆神",
    "洋葱学园",
    "叫叫",
    "Duolingo（多邻国）",
    "Khan Academy",
    "Chegg",
    "Quizlet",
    "Speak",
]

# 显示名 -> 匹配别名（用于公司和标签对齐）
COMPANY_ALIASES = {
    "好未来": ["好未来", "TAL", "TAL Education"],
    "学而思": ["学而思"],
    "新东方": ["新东方"],
    "猿辅导": ["猿辅导", "小猿"],
    "斑马": ["斑马"],
    "作业帮": ["作业帮"],
    "有道": ["有道", "网易有道"],
    "网易有道": ["网易有道", "有道"],
    "讯飞": ["讯飞", "科大讯飞"],
    "科大讯飞": ["科大讯飞", "讯飞"],
    "高途": ["高途"],
    "豆神": ["豆神", "豆神教育"],
    "豆神教育": ["豆神教育", "豆神"],
    "洋葱学园": ["洋葱学园"],
    "叫叫": ["叫叫"],
    "Duolingo": ["Duolingo", "多邻国", "Duolingo（多邻国）"],
    "Khan Academy": ["Khan Academy", "Khanmigo", "可汗学院", "Khan"],
    "Chegg": ["Chegg"],
    "Quizlet": ["Quizlet"],
    "Speak": ["Speak"],
    "字节跳动": ["字节跳动", "豆包", "ByteDance"],
    "豆包": ["豆包", "豆包爱学", "字节跳动"],
    "阿里巴巴": ["阿里巴巴", "千问", "阿里"],
    "千问": ["千问", "阿里 千问"],
    "Google": ["Google", "谷歌", "Gemini", "DeepMind"],
    "OpenAI": ["OpenAI", "ChatGPT"],
    "Anthropic": ["Anthropic", "Claude"],
}

CANON_COMPANY = {}
for _canon, _aliases in COMPANY_ALIASES.items():
    # Prefer longer official names when both short and long exist; map both ways.
    for a in _aliases:
        CANON_COMPANY[a.lower()] = _canon
# Prefer official long names for these shorts when storing/matching filters
DISPLAY_NAME = {
    "有道": "有道",
    "网易有道": "有道",
    "讯飞": "讯飞",
    "科大讯飞": "讯飞",
    "豆神": "豆神",
    "豆神教育": "豆神",
    "Khan": "Khan Academy",
    "Duolingo": "Duolingo（多邻国）",
    "多邻国": "Duolingo（多邻国）",
    "Duolingo（多邻国）": "Duolingo（多邻国）",
}

SPLIT_CO = re.compile(r"\s*[›>／/]\s*")


def base_label(value: str | None) -> str:
    if not value:
        return ""
    return str(value).split("｜")[0].strip()


def with_inferred(value: str, inferred: bool) -> str:
    v = (value or "").strip() or "待定"
    if inferred and "｜推断" not in v and v != "待定":
        return f"{v}｜推断"
    return v


def pick_vocab(value: str | None, vocab: list[str], default: str = "待定") -> str:
    """Keep ｜推断 / 待定. Accept exact or base-term matches."""
    if value is None or str(value).strip() == "":
        return default
    raw = str(value).strip()
    base = base_label(raw)
    if raw == "待定" or base == "待定":
        return "待定"
    for item in vocab:
        if raw == item or base == item:
            return raw if raw.startswith(item) else (f"{item}｜推断" if "推断" in raw else item)
    return default


def display_subject(topic: str | None, subject: str | None) -> str:
    """Upstream 全科通用 + 政策/融资/泛 AI 主题 → 显示为 不涉及（上游已改则沿用）。"""
    sub = subject if subject not in (None, "") else "待定"
    top = base_label(topic)
    if base_label(sub) == "全科通用" and top in SUBJECT_OVERRIDE_TOPICS:
        suffix = "｜推断" if "｜推断" in str(sub) else ""
        return "不涉及" + suffix
    return pick_vocab(sub, SUBJECTS)


def parse_company_token(token: str) -> tuple[str, str | None] | None:
    s = (token or "").strip()
    if s in NONE_COMPANY:
        return None
    if SPLIT_CO.search(s):
        left, right = SPLIT_CO.split(s, 1)
        return (left.strip(), right.strip() or None)
    return (s, None)


def company_display(token: str) -> str | None:
    parsed = parse_company_token(token)
    if not parsed:
        return None
    company, brand = parsed
    head = DISPLAY_NAME.get(company, company)
    if brand:
        return f"{head} › {brand}"
    return head


def company_matches(token: str, selected: str) -> bool:
    """True if a company tag (maybe 公司 › 品牌) matches a selected filter chip."""
    parsed = parse_company_token(token)
    if not parsed:
        return False
    company, brand = parsed
    aliases = set(a.lower() for a in COMPANY_ALIASES.get(selected, [selected]))
    aliases.add(selected.lower())
    # also match via canon
    for name in (company, brand or "", selected):
        canon = CANON_COMPANY.get(name.lower())
        if canon:
            aliases.update(a.lower() for a in COMPANY_ALIASES.get(canon, [canon]))
            aliases.add(canon.lower())
    return company.lower() in aliases or (brand or "").lower() in aliases or selected.lower() in {
        company.lower(),
        (brand or "").lower(),
    }


def normalize_companies(values) -> list[str]:
    if values is None:
        return []
    if isinstance(values, str):
        values = [values] if values else []
    out = []
    seen = set()
    for v in values:
        s = str(v).strip()
        if not s:
            continue
        if s in NONE_COMPANY:
            continue
        if s not in seen:
            seen.add(s)
            out.append(s)
    return out


def empty_tags() -> dict:
    return {
        "topic": "待定",
        "subject": "待定",
        "companies": [],
        "form": "待定",
        "content_type": "待定",
    }



# 只清技能名、仓库名、文件名式字符串。真实用到的产品即使不在竞品清单里也保留原名（如 Grok Bot、腾讯 › WorkBuddy）。
# 小红书是发帖平台，不作为公司标签。
NON_COMPANY = {
    "story-to-handdrawn-video",
    "education-agent-skills",
    "socratic-tutor",
    "os-taxonomy",
}
PLATFORM_NOT_COMPANY = {"小红书", "X", "Twitter", "x.com"}
REPO_NAME_RE = re.compile(r"^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+$")


def is_filename_or_skill(token: str) -> bool:
    s = (token or "").strip()
    if not s:
        return True
    if s in NON_COMPANY:
        return True
    if REPO_NAME_RE.match(s):
        return True
    return False


def clean_companies(values) -> list[str]:
    """Drop skill/repo/filename strings and platform names. Keep real products under their original names."""
    out = []
    seen = set()
    for v in normalize_companies(values):
        if v in PLATFORM_NOT_COMPANY or v in NONE_COMPANY:
            continue
        if SPLIT_CO.search(v):
            left, right = SPLIT_CO.split(v, 1)
            left, right = left.strip(), right.strip()
            if left in PLATFORM_NOT_COMPANY or left in NONE_COMPANY:
                continue
            if is_filename_or_skill(left):
                continue
            if not right or is_filename_or_skill(right):
                v = DISPLAY_NAME.get(left, left)
            elif DISPLAY_NAME.get(right, right) == DISPLAY_NAME.get(left, left):
                # 多邻国 › Duolingo → one company, not a product pair
                v = DISPLAY_NAME.get(left, left)
            else:
                v = f"{DISPLAY_NAME.get(left, left)} › {right}"
        else:
            if is_filename_or_skill(v):
                continue
            v = DISPLAY_NAME.get(v, v)
        if v and v not in seen:
            seen.add(v)
            out.append(v)
    return out


def company_chip_name(token: str) -> str | None:
    """Display name for a filter chip (parent company or standalone product)."""
    if not token or token in PLATFORM_NOT_COMPANY or token in NONE_COMPANY:
        return None
    if is_filename_or_skill(token) and not SPLIT_CO.search(token):
        return None
    parsed = parse_company_token(token)
    if not parsed:
        return None
    company, _brand = parsed
    if not company or company in PLATFORM_NOT_COMPANY or company in NONE_COMPANY:
        return None
    if is_filename_or_skill(company):
        return None
    return DISPLAY_NAME.get(company, company)


def normalize_tag_set(raw: dict | None) -> dict | None:
    if not raw:
        return None
    topic = raw.get("topic")
    subject = raw.get("subject")
    form = raw.get("form")
    content_type = raw.get("content_type")
    companies = raw.get("companies")
    if topic in (None, "") and subject in (None, "") and form in (None, "") and content_type in (None, "") and not companies:
        return None
    return {
        "topic": pick_vocab(topic, TOPICS),
        "subject": display_subject(topic, subject),
        "subject_raw": subject if subject not in (None, "") else "待定",
        "companies": clean_companies(companies) if companies not in (None, ["不涉及"], "不涉及") else [],
        "form": pick_vocab(form, FORMS),
        "content_type": pick_vocab(content_type, CONTENT_TYPES),
    }


def extract_upstream_tags(post: dict | None) -> dict | None:
    if not post:
        return None
    return normalize_tag_set({
        "topic": post.get("topic"),
        "subject": post.get("subject"),
        "companies": post.get("companies"),
        "form": post.get("form"),
        "content_type": post.get("content_type"),
    })


def resolve_x_tags(post: dict, bak_by_url: dict[str, dict]) -> tuple[dict | None, str | None]:
    """Prefer grok-posts.json; else bak by URL; else None (caller may DeepSeek)."""
    tags = extract_upstream_tags(post)
    if tags and tags.get("topic") != "待定":
        return tags, "grok-posts"
    if tags and any(tags.get(k) not in (None, "", "待定", []) for k in ("subject", "form", "content_type", "companies")):
        return tags, "grok-posts"
    url = (post.get("url") or "").rstrip("/")
    bak = bak_by_url.get(url) or bak_by_url.get(url + "/")
    tags_b = extract_upstream_tags(bak)
    if tags_b:
        return tags_b, "bak"
    return None, None


def load_bak_tags(path: Path) -> dict[str, dict]:
    if not path.exists():
        return {}
    data = json.loads(path.read_text(encoding="utf-8-sig"))
    posts = data["posts"] if isinstance(data, dict) else data
    out = {}
    for p in posts:
        u = (p.get("url") or "").rstrip("/")
        if u:
            out[u] = p
    return out


def load_products(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return list(csv.DictReader(path.read_text(encoding="utf-8-sig").splitlines()))


def load_logo_csv(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return list(csv.DictReader(path.read_text(encoding="utf-8-sig").splitlines()))


def vocab_prompt_block() -> str:
    return (
        "标签词表（必须从中选；拿不准标「待定」；仅在材料未写明、是根据上下文推出时在值后加「｜推断」）：\n"
        f"1. topic 主题（单选）：{'｜'.join(TOPICS)}\n"
        f"2. subject 学科能力（单选）：{'｜'.join(SUBJECTS)}\n"
        "   全科通用＝产品或内容覆盖多学科；政策、融资、泛 AI 话题没落到学科的记「不涉及」。\n"
        "3. companies 公司与产品（多选，字符串数组）：按「公司 › 品牌」两层；清单里没有的写原名；不涉及则 []。\n"
        f"4. form 形态（单选）：{'｜'.join(FORMS)}\n"
        "   Skill、提示词类：跑在大模型上的记「大模型学习模式」，content_type 记「教程与提示词」。\n"
        f"5. content_type 内容类型（单选）：{'｜'.join(CONTENT_TYPES)}\n"
        "内容类型与发帖人身份分开记。"
    )
