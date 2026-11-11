// Five-dimension tags (taxonomy.md) for media and 社区热帖. Catalog: AIHOT_DATA_DIR/content-tags.json.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { config, REPO_ROOT } from "../config.ts";

export const FACET_VOCAB = {
  topic: ["公司与资本", "产品与功能", "政策与合规", "研究与证据", "教学实践", "观点与趋势"],
  subject: ["表达与口语", "阅读写作", "绘本伴读", "情商与SEL", "英语", "数理与提分", "全科通用", "不涉及"],
  form: ["App与网页", "大模型学习模式", "教师工具与平台", "学习机与平板", "词典笔与点读绘本机", "AI玩具与陪伴设备", "服务（线下或真人+AI）", "不涉及"],
  content_type: ["新闻快讯", "官方发布", "深度分析", "测评体验", "研究报告", "观点评论", "教程与提示词", "用户自述"],
} as const;

export const HEAD_COMPANIES = [
  "好未来", "学而思", "新东方", "猿辅导", "作业帮", "有道", "讯飞", "高途", "豆神", "洋葱学园", "叫叫",
  "Duolingo（多邻国）", "Khan Academy", "Chegg", "Quizlet", "Speak",
] as const;

export interface ContentTags {
  topic?: string;
  subject?: string;
  companies?: string[];
  form?: string;
  content_type?: string;
}

export interface FacetQuery {
  topic?: string[];
  subject?: string[];
  form?: string[];
  content_type?: string[];
  company?: string[];
}

export function baseLabel(value: string | null | undefined): string {
  if (!value) return "";
  return String(value).split("｜")[0].trim();
}

export function parseFacetQuery(q: Record<string, string>): FacetQuery {
  const list = (v: string | undefined) =>
    (v ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  return {
    topic: list(q.topic),
    subject: list(q.subject),
    form: list(q.form),
    content_type: list(q.content_type),
    company: list(q.company),
  };
}

export function facetsActive(f: FacetQuery | undefined): boolean {
  if (!f) return false;
  return Boolean(f.topic?.length || f.subject?.length || f.form?.length || f.content_type?.length || f.company?.length);
}

function loadJson(paths: string[]): Record<string, unknown> | null {
  for (const p of paths) {
    try {
      if (!existsSync(p)) continue;
      return JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
    } catch {
      /* next */
    }
  }
  return null;
}

export function loadLogoIndex(): { index: Record<string, string>; missing: string[]; items: Array<{ name: string; path: string; source_url?: string }> } {
  const raw = loadJson([
    path.join(config.dataDir, "logos/sources.json"),
    "/app/apps/web/public/logos/sources.json",
    path.join(path.resolve(config.dataDir, ".."), "apps/web/public/logos/sources.json"),
    path.join(path.resolve(config.dataDir, ".."), "static/logos/sources.json"),
  ]);
  if (!raw) return { index: {}, missing: [], items: [] };
  const index = { ...((raw.index as Record<string, string>) ?? {}) };
  const items = ((raw.items as Array<{ name: string; path: string; source_url?: string }>) ?? []).map((it) => ({
    name: it.name, path: it.path, source_url: it.source_url,
  }));
  for (const it of items) if (it.name && it.path) index[it.name] = it.path;
  const missing = ((raw.missing as Array<{ name: string }>) ?? []).map((m) => m.name);
  return { index, missing, items };
}

export function loadContentTagMap(): Record<string, ContentTags> {
  const raw = loadJson([
    path.join(config.dataDir, "content-tags.json"),
    path.join(path.resolve(config.dataDir, ".."), ".data/content-tags.json"),
  ]);
  if (!raw) return {};
  const items = (raw.items ?? {}) as Record<string, ContentTags & { id?: string; article_id?: string; url?: string; kind?: string }>;
  const out: Record<string, ContentTags> = {};
  for (const rec of Object.values(items)) {
    const tags: ContentTags = {
      topic: rec.topic, subject: rec.subject, companies: rec.companies, form: rec.form, content_type: rec.content_type,
    };
    for (const key of [rec.id, rec.article_id, rec.url]) {
      if (key) out[key] = tags;
    }
  }
  return out;
}

function companyMatches(token: string, selected: string): boolean {
  const parts = token.split(/\s*[›>／/]\s*/).map((s) => s.trim()).filter(Boolean);
  const aliases: Record<string, string[]> = {
    有道: ["有道", "网易有道"],
    讯飞: ["讯飞", "科大讯飞"],
    豆神: ["豆神", "豆神教育"],
    "Khan Academy": ["Khan Academy", "Khan", "可汗学院"],
    Duolingo: ["Duolingo", "多邻国", "Duolingo（多邻国）"],
    "Duolingo（多邻国）": ["Duolingo", "多邻国", "Duolingo（多邻国）"],
    多邻国: ["Duolingo", "多邻国", "Duolingo（多邻国）"],
  };
  const names = new Set([selected, ...(aliases[selected] ?? [])].map((s) => s.toLowerCase()));
  return parts.some((p) => names.has(p.toLowerCase()) || p === selected || selected.includes(p) || p.includes(selected));
}

export function tagsMatchFacets(tags: ContentTags | undefined, facets: FacetQuery): boolean {
  const hit = (sel: string[] | undefined, value: string | undefined) =>
    !sel?.length || (value != null && sel.includes(baseLabel(value)));
  if (!hit(facets.topic, tags?.topic)) return false;
  if (!hit(facets.subject, tags?.subject)) return false;
  if (!hit(facets.form, tags?.form)) return false;
  if (!hit(facets.content_type, tags?.content_type)) return false;
  if (facets.company?.length) {
    const tokens = tags?.companies ?? [];
    if (!facets.company.some((c) => tokens.some((token) => companyMatches(token, c)))) return false;
  }
  return true;
}

export function articleIdsMatchingFacets(facets: FacetQuery): string[] | null {
  if (!facetsActive(facets)) return null;
  const map = loadContentTagMap();
  const ids = new Set<string>();
  for (const [key, tags] of Object.entries(map)) {
    if (key.startsWith("http") || key.startsWith("www")) continue;
    if (tagsMatchFacets(tags, facets)) ids.add(key);
  }
  return [...ids];
}

function chipName(token: string): string | null {
  if (!token || token === "不涉及" || token === "未查到" || token === "待定" || token === "小红书" || token === "X") return null;
  // filename / skill
  if (/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+$/.test(token) && !token.includes("›")) return null;
  const company = token.split(/\s*[›>／/]\s*/)[0]?.trim();
  if (!company) return null;
  const display: Record<string, string> = { 网易有道: "有道", 科大讯飞: "讯飞", 豆神教育: "豆神", Khan: "Khan Academy", Duolingo: "Duolingo（多邻国）", 多邻国: "Duolingo（多邻国）" };
  return display[company] ?? company;
}

export function loadFacetsMeta() {
  const map = loadContentTagMap();
  const counts = {
    topic: {} as Record<string, number>,
    subject: {} as Record<string, number>,
    form: {} as Record<string, number>,
    content_type: {} as Record<string, number>,
    company: {} as Record<string, number>,
  };
  const seen = new Set<string>();
  for (const [key, tags] of Object.entries(map)) {
    const uniq = tags && (tags.topic || tags.subject || tags.form || tags.content_type || tags.companies)
      ? `${tags.topic}|${tags.subject}|${(tags.companies ?? []).join(",")}|${key.startsWith("http") ? key : "id:"+key}`
      : key;
    // Prefer article ids over url duplicates: skip if we already counted this exact tag payload for another key with same title? Count each unique id once; urls and ids may duplicate.
    const id = key.startsWith("http") ? `url:${key}` : `id:${key}`;
    if (seen.has(id)) continue;
    // If both id and url exist, we'll count twice unless we only count non-url or only id keys.
    if (key.startsWith("http") || key.startsWith("www")) continue;
    seen.add(id);
    const inc = (bag: Record<string, number>, value?: string) => {
      const b = baseLabel(value);
      if (b && b !== "待定") bag[b] = (bag[b] ?? 0) + 1;
    };
    inc(counts.topic, tags.topic);
    inc(counts.subject, tags.subject);
    inc(counts.form, tags.form);
    inc(counts.content_type, tags.content_type);
    for (const token of tags.companies ?? []) {
      const name = chipName(token);
      if (name) counts.company[name] = (counts.company[name] ?? 0) + 1;
    }
  }
  return {
    vocab: FACET_VOCAB,
    headCompanies: [...HEAD_COMPANIES],
    logos: loadLogoIndex(),
    counts,
  };
}
