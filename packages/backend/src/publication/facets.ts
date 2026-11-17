// Five-dimension tags (taxonomy.md) for media and 社区热帖. Catalog: AIHOT_DATA_DIR/content-tags.json.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { baseLabel, companyName, companyNames, FACET_VOCAB, HEAD_COMPANIES } from "@aihot/contracts/facets";
import { config } from "../config.ts";
import { sql } from "../db.ts";

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

/**
 * The reports whose stored five dimensions (article_facets) match: within a dimension any chosen
 * value, across dimensions all of them. Empty when no dimension is chosen.
 */
export function articleFacetCondition(f: FacetQuery) {
  if (!facetsActive(f)) return sql``;
  const pick = (column: "topic" | "subject" | "form" | "content_type", values: string[] | undefined) =>
    values?.length ? sql`AND af.${sql(column)} IN ${sql(values.map(baseLabel))}` : sql``;
  const companies = [...new Set((f.company ?? []).flatMap((c) => companyName(c) ?? []))];
  const company = f.company?.length ? sql`AND af.companies && ${companies}::text[]` : sql``;
  return sql`AND p.article_id IN (SELECT af.article_id FROM article_facets af WHERE TRUE
    ${pick("topic", f.topic)} ${pick("subject", f.subject)} ${pick("form", f.form)} ${pick("content_type", f.content_type)} ${company})`;
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
    for (const name of new Set((tags.companies ?? []).flatMap((t) => companyNames(t).slice(0, 1)))) counts.company[name] = (counts.company[name] ?? 0) + 1;
  }
  return {
    vocab: FACET_VOCAB,
    headCompanies: [...HEAD_COMPANIES],
    logos: loadLogoIndex(),
    counts,
  };
}
