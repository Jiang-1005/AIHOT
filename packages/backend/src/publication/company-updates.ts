// 国内公司动态：可按时间（各公司混排、最新在前，每条标明公司）或按公司查看已核对（或标明「未查到原文」）的报道。
// 不走精选 60 分 / 7 天门槛；窗口以文章自己的日期为主，默认最近 90 个北京日历日。
// 没有动态的公司写「近 90 天未查到」，不拿旧稿凑数。名单里每家公司地位相同，不置顶任何一家。
// 公开输出按 site/public-copy.ts 去掉站点配置的隐藏词。
// 同一事件若有 items-backfill*.csv 补录，保留补录那条原媒体链接；否则原媒体优先于转载。X / 小红书等社区帖不进本栏目，只在 /voices。
import { sql } from "../db.ts";
import { beijingDate, beijingTime } from "@aihot/contracts/time";
import { publicSourceName } from "./rules.ts";
import { loadContentTagMap, loadLogoIndex } from "./facets.ts";
import { publicCopy } from "@aihot/site/public-copy";

export const COMPANY_LOOKBACK_DAYS = 90;
export const COMPANY_WINDOW_DAYS = COMPANY_LOOKBACK_DAYS;
export const COMPANY_PREVIEW_MAX = 5;
export const COMPANY_LIST_MIN = 3;
export const COMPANY_LIST_MAX = 5;

export interface CompanyRosterEntry {
  id: string;
  name: string;
  aliases: string[];
}

/** 栏目名单：taxonomy 里的主体与别名，再加上栏目标明要收录的品牌。 */
export const COMPANY_ROSTER: readonly CompanyRosterEntry[] = [
  { id: "zuoyebang", name: "作业帮", aliases: ["作业帮", "ZYBANG", "喵喵机"] },
  { id: "yuanfudao", name: "猿辅导", aliases: ["猿辅导", "小猿", "猿力科技", "小猿口算", "小猿搜题", "Yuanfudao"] },
  { id: "xueersi", name: "学而思/好未来", aliases: ["学而思", "好未来", "TAL", "学而思 / 好未来", "学而思/好未来", "TAL Education"] },
  { id: "xdf", name: "新东方", aliases: ["新东方"] },
  { id: "youdao", name: "有道", aliases: ["有道", "网易有道", "Youdao"] },
  { id: "iflytek", name: "讯飞", aliases: ["讯飞", "科大讯飞", "iFlytek", "iFLYTEK"] },
  { id: "gaotu", name: "高途", aliases: ["高途"] },
  { id: "dougod", name: "豆神", aliases: ["豆神", "豆神教育", "ST豆神"] },
  { id: "huakai", name: "心田花开", aliases: ["心田花开", "花啦啦"] },
  { id: "bmma", name: "斑马", aliases: ["斑马", "斑马AI课", "斑马课", "掌门"] },
  { id: "jiaojao", name: "叫叫", aliases: ["叫叫", "叫叫阅读", "绿豆豆英语", "绿豆豆"] },
  { id: "doubao", name: "豆包爱学", aliases: ["豆包爱学", "豆包"] },
  { id: "songshu", name: "松鼠Ai", aliases: ["松鼠Ai", "松鼠AI", "松鼠ai", "Squirrel"] },
  { id: "dushulang", name: "读书郎", aliases: ["读书郎"] },
  { id: "yangcong", name: "洋葱学园", aliases: ["洋葱学园", "洋葱"] },
  { id: "bubugao", name: "步步高", aliases: ["步步高"] },
  { id: "seewo", name: "希沃", aliases: ["希沃", "视源", "视源股份"] },
  { id: "xueweigui", name: "学为贵", aliases: ["学为贵"] },
  { id: "xiaolu", name: "银河智学（小鹿爱学）", aliases: ["小鹿爱学", "小鹿愛學", "银河智学", "銀河智學", "银河智学（小鹿爱学）", "北京银河智学", "北京银河智学教育科技有限公司"] },
  { id: "kaiwen", name: "凯文教育", aliases: ["凯文教育"] },
  { id: "17zuoye", name: "一起教育", aliases: ["一起教育", "一起教育科技", "一起作业"] },
];


export function mapCompanyLabel(raw: string | null | undefined): CompanyRosterEntry | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  for (const company of COMPANY_ROSTER) {
    if (tokenMatchesCompany(text, company)) return company;
  }
  return null;
}

function normalizeToken(value: string): string {
  return value.replace(/（.*?）/g, "").replace(/\(.*?\)/g, "").split("｜")[0]!.split("›")[0]!.trim();
}

function tokenMatchesCompany(token: string, company: CompanyRosterEntry): boolean {
  if (token === `entity:${company.id}` || token.toLowerCase() === `entity:${company.id}`) return true;
  const parts = token.split(/[›>/／、,，;；|]+/).map((p) => normalizeToken(p)).filter(Boolean);
  const candidates = [...new Set([normalizeToken(token), ...parts])];
  for (const alias of company.aliases) {
    const aliasNorm = alias.toLowerCase();
    for (const candidate of candidates) {
      if (candidate.toLowerCase() === aliasNorm) return true;
    }
  }
  return false;
}

function tokensFor(item: { tags: string[]; companies: string[]; rawCompany: string | null; title: string }): string[] {
  return [...item.tags, ...item.companies, item.rawCompany ?? ""].filter(Boolean);
}

export function companiesForItem(item: { tags: string[]; companies: string[]; rawCompany: string | null; title?: string | null }): CompanyRosterEntry[] {
  // Prefer editorial company tags (content-tags.json). publication.tags can carry
  // mistaken entity labels; only fall back to them when the catalog has no companies.
  const tokens = [
    ...(item.companies?.length ? item.companies : item.tags),
    item.rawCompany ?? "",
  ].filter(Boolean);
  const hits: CompanyRosterEntry[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    for (const company of COMPANY_ROSTER) {
      if (seen.has(company.id)) continue;
      if (tokenMatchesCompany(token, company)) {
        seen.add(company.id);
        hits.push(company);
      }
    }
  }
  return hits;
}

export function originChecked(verify: string | null, bodyStatus: string | null, summary: string | null, title: string | null): { ok: boolean; unverified: boolean } {
  const blob = `${verify ?? ""} ${summary ?? ""} ${title ?? ""}`;
  const unverified = /未查到原文/.test(blob);
  const checked = /已核对原文|已打开原文核对/.test(verify ?? "") || bodyStatus === "ok";
  return { ok: checked || unverified, unverified };
}

export function articleDay(publicationTime: string | null, publishedAt: Date | null): string | null {
  const raw = publicationTime?.trim() ?? "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) return beijingDate(raw);
  if (publishedAt) return beijingDate(publishedAt);
  return null;
}

export function windowStartDay(now = new Date(), days = COMPANY_LOOKBACK_DAYS): string {
  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return beijingDate(start);
}

export function scrubPublic(text: string | null | undefined): string {
  return publicCopy(String(text ?? ""))
    .replace(/[ \t]{2,}/g, " ")
    .replace(/，{2,}/g, "，")
    .replace(/^[-—、，。\s]+/, "")
    .trim();
}

export function publicSummary(raw: string | null | undefined, title: string): string | undefined {
  const text = scrubPublic(raw);
  if (!text || text === title) return undefined;
  return text;
}

/** Keep a real clock time when we have one; date-only values must not become 08:00 / 00:00 on the rail. */
export function publicPublishedAt(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  const instant = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(instant.getTime())) return undefined;
  if (beijingTime(instant) === "00:00") return undefined;
  return instant.toISOString();
}

export interface CompanyUpdateItem {
  id: string;
  title: string;
  url: string;
  date: string;
  source: string;
  unverified: boolean;
  /** Scrubbed public summary, omitted when missing. */
  summary?: string;
  /** ISO instant with a real clock time, omitted for date-only items. */
  publishedAt?: string;
  /** 同一篇文章出现在多家公司栏目下（例如「一周连连看」），保留并标明。 */
  multiCompany?: boolean;
  /** 这条动态归属的公司，按时间混排时用来标名。 */
  companies?: { id: string; name: string }[];
}

/** 同一事件：标题足够像，且日期相差不超过这么多北京日历日。 */
export const COMPANY_EVENT_DATE_WINDOW_DAYS = 3;
export const COMPANY_EVENT_TITLE_SIMILARITY = 0.3;

export function normalizeCompanyTitle(title: string): string {
  let text = String(title ?? "").toLowerCase();
  text = text.replace(/【.*?】/g, " ");
  text = text.replace(/q1/g, "第1季度").replace(/q2/g, "第2季度").replace(/q3/g, "第3季度").replace(/q4/g, "第4季度");
  text = text.replace(/第一财季|第一季度|一季度/g, "第1季度");
  text = text.replace(/第二财季|第二季度|二季度/g, "第2季度");
  text = text.replace(/第三财季|第三季度|三季度/g, "第3季度");
  text = text.replace(/第四财季|第四季度|四季度/g, "第4季度");
  text = text.replace(/公布|发布|举行|举办|在京|主题聚焦|共话|推出/g, "");
  return text.replace(/[^\u4e00-\u9fff0-9a-z]+/g, "");
}

/** Strip tracking query and hash so the same article with ?from=guba is one item. */
export function normalizeCompanyUrl(url: string): string {
  const raw = String(url ?? "").trim();
  try {
    const parsed = new URL(raw);
    parsed.hash = "";
    parsed.search = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return raw.replace(/#.*$/, "").replace(/\?.*$/, "").replace(/\/$/, "");
  }
}

function titleBigrams(text: string): Set<string> {
  const grams = new Set<string>();
  for (let i = 0; i < text.length - 1; i++) grams.add(text.slice(i, i + 2));
  return grams;
}

export function titleSimilarity(a: string, b: string): number {
  const left = titleBigrams(normalizeCompanyTitle(a));
  const right = titleBigrams(normalizeCompanyTitle(b));
  if (!left.size || !right.size) return 0;
  let inter = 0;
  for (const gram of left) if (right.has(gram)) inter += 1;
  return inter / (left.size + right.size - inter);
}

function dayOffset(a: string, b: string): number {
  const left = Date.parse(`${a}T00:00:00+08:00`);
  const right = Date.parse(`${b}T00:00:00+08:00`);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return 99;
  return Math.abs(left - right) / 86_400_000;
}

export function sameCompanyEvent(
  a: { title: string; date: string },
  b: { title: string; date: string },
  windowDays = COMPANY_EVENT_DATE_WINDOW_DAYS,
  minSim = COMPANY_EVENT_TITLE_SIMILARITY,
): boolean {
  if (dayOffset(a.date, b.date) > windowDays) return false;
  return titleSimilarity(a.title, b.title) >= minSim;
}

/** 来自行业观察 items-backfill*.csv 的补录（不是站内自抓或 cn-sources 历史导入）。 */
export function isCompanyBackfill(row: { brief?: string | null; backfillReason?: string | null }): boolean {
  return row.brief === "company-backfill" || row.backfillReason === "company-backfill";
}

/** X / 小红书等社区帖只进 /voices，不进国内公司动态。 */
export function isCommunityVoiceItem(row: {
  url?: string | null;
  sourceId?: string | null;
  sourceKind?: string | null;
  hasXPost?: boolean;
  hasXArticle?: boolean;
}): boolean {
  if (row.hasXPost || row.hasXArticle) return true;
  const url = row.url || "";
  if (/\/\/(?:www\.)?(?:x|twitter)\.com\//i.test(url) || /xiaohongshu\.com|xhslink\.com/i.test(url)) return true;
  const kind = (row.sourceKind || "").toLowerCase();
  if (kind === "x" || kind === "twitter" || kind === "xiaohongshu" || kind === "xhs") return true;
  const id = row.sourceId || "";
  return /^(x-|ext-x-|twitter-|xhs-|xiaohongshu)/i.test(id);
}

export type CompanyEventPreferable = {
  id: string;
  date: string;
  source: string;
  unverified: boolean;
  fromBackfill?: boolean;
  summary?: string;
};

/** 分数高的更像原媒体报道，转载/聚合站靠后。补录优先级在 preferCompanyEventItem 里单独处理。 */
export function originalMediaScore(item: { source: string; unverified: boolean; date: string }): number {
  const src = item.source || "";
  let score = 0;
  if (item.unverified) score -= 30;
  if (/转载|转自|据/.test(src)) score -= 40;
  if (/同花顺|东方财富|财富号/.test(src)) score -= 20;
  if (/新华|人民日报|中新网|中国教育报|中国政府网|教育部|科技日报|光明网/.test(src)) score += 12;
  if (/多知|芥末堆|澎湃|人民政协|中国证券报|中证网/.test(src)) score += 8;
  const day = Date.parse(`${item.date}T00:00:00+08:00`);
  if (Number.isFinite(day)) score -= Math.round((day - Date.parse("2020-01-01T00:00:00+08:00")) / 86_400_000) * 0.01;
  return score;
}

/** 同一事件保留顺序：items-backfill 补录（其原媒体链接）> 原媒体 > 转载。 */
export function preferCompanyEventItem<T extends CompanyEventPreferable>(a: T, b: T): number {
  if (Boolean(b.fromBackfill) !== Boolean(a.fromBackfill)) return Number(Boolean(b.fromBackfill)) - Number(Boolean(a.fromBackfill));
  const diff = originalMediaScore(b) - originalMediaScore(a);
  if (diff) return diff;
  const summaryDiff = (b.summary?.length ?? 0) - (a.summary?.length ?? 0);
  if (summaryDiff) return summaryDiff;
  return a.date.localeCompare(b.date) || a.id.localeCompare(b.id);
}

/** 同一公司栏目内，相近日期、标题相似的报道只留一条：补录优先，其次原媒体。 */
export function dedupeCompanyEvents<T extends CompanyEventPreferable & { url: string; title: string }>(items: T[]): T[] {
  const uniq: T[] = [];
  const indexByKey = new Map<string, number>();
  for (const item of items) {
    const keys = [item.id, normalizeCompanyUrl(item.url)].filter(Boolean);
    const existingIdx = keys.map((key) => indexByKey.get(key)).find((idx) => idx !== undefined);
    if (existingIdx !== undefined) {
      const better = [uniq[existingIdx]!, item].sort(preferCompanyEventItem)[0]!;
      uniq[existingIdx] = better;
      for (const key of [...keys, better.id, normalizeCompanyUrl(better.url)]) {
        if (key) indexByKey.set(key, existingIdx);
      }
      continue;
    }
    const idx = uniq.length;
    uniq.push(item);
    for (const key of keys) indexByKey.set(key, idx);
  }
  const parent = uniq.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  for (let i = 0; i < uniq.length; i++) {
    for (let j = i + 1; j < uniq.length; j++) {
      if (!sameCompanyEvent(uniq[i]!, uniq[j]!)) continue;
      const a = find(i);
      const b = find(j);
      if (a !== b) parent[b] = a;
    }
  }
  const groups = new Map<number, T[]>();
  uniq.forEach((item, i) => {
    const root = find(i);
    const group = groups.get(root) ?? [];
    group.push(item);
    groups.set(root, group);
  });
  return [...groups.values()]
    .map((group) => group.slice().sort(preferCompanyEventItem)[0]!)
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
}

export interface CompanyUpdateSection {
  id: string;
  name: string;
  items: CompanyUpdateItem[];
  empty: boolean;
  previewMax: number;
  latest: string | null;
}

/** 按各公司最近一条动态的日期倒序；没有动态的排在后面。 */
export function sortCompaniesByLatest<T extends { name: string; items: { date: string }[]; latest?: string | null; empty?: boolean }>(companies: T[]): T[] {
  return companies.slice().sort((a, b) => {
    const da = a.latest ?? a.items[0]?.date ?? "";
    const db = b.latest ?? b.items[0]?.date ?? "";
    if (db !== da) return db.localeCompare(da);
    return a.name.localeCompare(b.name, "zh");
  });
}

/** 各公司动态去重后按日期倒序混排，用于「按时间」视图。 */
export function flattenCompanyTimeline(companies: CompanyUpdateSection[]): CompanyUpdateItem[] {
  const map = new Map<string, CompanyUpdateItem>();
  for (const company of companies) {
    for (const item of company.items) {
      if (!map.has(item.id)) map.set(item.id, item);
    }
  }
  return [...map.values()].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
}

export async function loadCompanyUpdatesPage(now = new Date()) {
  const since = windowStartDay(now);
  const today = beijingDate(now);
  const tagMap = loadContentTagMap();
  const logos = loadLogoIndex();

  const rows = await sql<{
    id: string;
    title: string;
    summary: string | null;
    url: string;
    published_at: Date | null;
    publication_time: string | null;
    source_name: string;
    tags: string[] | null;
    verify: string | null;
    raw_company: string | null;
    body_status: string | null;
    visibility: string | null;
    brief: string | null;
    backfill_reason: string | null;
    source_id: string | null;
    source_kind: string | null;
    has_x_post: boolean;
    has_x_article: boolean;
  }[]>`
    SELECT a.id,
           coalesce(p.title, a.title) AS title,
           coalesce(p.summary, a.excerpt) AS summary,
           coalesce(p.url, a.url) AS url,
           coalesce(p.published_at, a.published_at) AS published_at,
           a.publication_time,
           coalesce(s.name, '') AS source_name,
           coalesce(p.tags, '{}'::text[]) AS tags,
           coalesce(a.raw->>'verify', a.raw->>'核验状态') AS verify,
           a.raw->>'company' AS raw_company,
           a.body_status,
           p.visibility,
           a.raw->>'brief' AS brief,
           a.backfill_reason,
           coalesce(p.source_id, a.source_id) AS source_id,
           s.kind AS source_kind,
           (a.x_post IS NOT NULL) AS has_x_post,
           (a.x_article IS NOT NULL) AS has_x_article
    FROM articles a
    LEFT JOIN publications p ON p.article_id = a.id
    LEFT JOIN sources s ON s.id = coalesce(p.source_id, a.source_id)
    WHERE (p.article_id IS NULL OR (p.visibility = 'public' AND p.channel = 'news'))
      AND (
        (a.publication_time ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND a.publication_time >= ${since})
        OR (coalesce(p.published_at, a.published_at) IS NOT NULL
            AND coalesce(p.published_at, a.published_at) >= (${since}::date - interval '1 day'))
      )
  `;

  const buckets = new Map<string, Array<CompanyUpdateItem & { fromBackfill?: boolean }>>();
  const itemCompanies = new Map<string, Set<string>>();
  for (const company of COMPANY_ROSTER) buckets.set(company.id, []);

  for (const row of rows) {
    if (row.visibility && row.visibility !== "public") continue;
    if (isCommunityVoiceItem({
      url: row.url,
      sourceId: row.source_id,
      sourceKind: row.source_kind,
      hasXPost: row.has_x_post,
      hasXArticle: row.has_x_article,
    })) continue;
    const day = articleDay(row.publication_time, row.published_at);
    if (!day || day < since || day > today) continue;
    const check = originChecked(row.verify, row.body_status, row.summary, row.title);
    if (!check.ok) continue;
    const facet = tagMap[row.id] ?? tagMap[row.url];
    const companies = companiesForItem({
      tags: row.tags ?? [],
      companies: facet?.companies ?? [],
      rawCompany: row.raw_company,
      title: row.title,
    });
    if (!companies.length) continue;
    const title = scrubPublic(row.title);
    const source = scrubPublic(publicSourceName(row.source_name));
    if (!title) continue;
    const item: CompanyUpdateItem & { fromBackfill?: boolean } = {
      id: row.id,
      title,
      url: row.url,
      date: day,
      source,
      unverified: check.unverified,
      summary: publicSummary(row.summary, title),
      publishedAt: publicPublishedAt(row.published_at),
      companies: companies.map((c) => ({ id: c.id, name: c.name })),
      fromBackfill: isCompanyBackfill({ brief: row.brief, backfillReason: row.backfill_reason }),
    };
    const seen = new Set<string>();
    for (const company of companies) {
      if (seen.has(company.id)) continue;
      seen.add(company.id);
      buckets.get(company.id)!.push(item);
      const hosts = itemCompanies.get(item.id) ?? new Set<string>();
      hosts.add(company.id);
      itemCompanies.set(item.id, hosts);
    }
  }

  const companies: CompanyUpdateSection[] = COMPANY_ROSTER.map((company) => {
    const items = [...(buckets.get(company.id) ?? [])].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
    // 同一文章先按 id/url 去重，再按标题相似度+相近日期合并同一事件。
    // 有 items-backfill 补录就留补录的原媒体链接，否则原媒体优先于转载。
    // 不足 3 条也原样展示，绝不拿窗口外的稿件凑数。
    const deduped = dedupeCompanyEvents(items).map(({ fromBackfill: _fromBackfill, ...item }) => ({
      ...item,
      multiCompany: (itemCompanies.get(item.id)?.size ?? 1) > 1,
    }));
    return {
      id: company.id,
      name: company.name,
      items: deduped,
      empty: deduped.length === 0,
      previewMax: COMPANY_PREVIEW_MAX,
      latest: deduped[0]?.date ?? null,
    };
  });

  const timeline = flattenCompanyTimeline(companies);

  return {
    asOf: today,
    since,
    section: "国内公司动态",
    previewMax: COMPANY_PREVIEW_MAX,
    companies,
    timeline,
    logos: { index: logos.index },
  };
}
