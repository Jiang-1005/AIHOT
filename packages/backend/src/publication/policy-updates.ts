// 国内政策：以行业观察 policy-backfill*.csv 为准，最近 90 个北京日历日、已核对原文（或标明「未查到原文」），按日期倒序。
// 雷达/站内同题政策帖与补录重复时只保留已核对原文的补录版本。全国五部门《人工智能+教育》行动计划是 4 月文件，不作为近三个月新政策。
// 标题或正文含「征求意见稿」的条目在页面标明「征求意见稿，未施行」。
// 不走精选 7 天 / 往期 30 天新鲜度规则，也不把老条目送进首页精选。
import { sql } from "../db.ts";
import { beijingDate } from "@aihot/contracts/time";
import { publicSourceName } from "./rules.ts";
import { loadContentTagMap } from "./facets.ts";
import {
  COMPANY_LOOKBACK_DAYS,
  articleDay,
  originChecked,
  publicPublishedAt,
  publicSummary,
  scrubPublic,
  windowStartDay,
} from "./company-updates.ts";

const FOREIGN_SOURCE = /The\s*74|Education Next|EdSurge|Chalkbeat|Hechinger|Boston\.com|Yahoo|Washington Post|Tes\b|UNESCO|K-12 Dive|EdWeek|Microsoft Education|OpenAI|Google (for Education|Blog)|EdWeek/i;
const POLICY_TAG = /政策\/监管|政策与合规|^政策$/;
const POLICY_TYPE = /政策|监管|法规|条例|通知|意见稿|规划纲要/;

export function rowLooksLikePolicy(row: { 信源类型?: string; 分类?: string; 类别?: string; 类型?: string }, fileName = ""): boolean {
  if (/policy-backfill/i.test(fileName)) return true;
  const typ = `${row["信源类型"] ?? ""} ${row["分类"] ?? ""} ${row["类别"] ?? ""} ${row["类型"] ?? ""}`;
  if (POLICY_TYPE.test(typ) && !/^(媒体|官方|国际媒体)\s*$/.test(typ.trim())) return true;
  if (/(^|[、,，\s])政策([、,，\s]|$)/.test(typ) || typ.includes("政策/监管") || typ.includes("政策与合规")) return true;
  return false;
}

function isDomestic(row: { source_name: string; title: string; country: string | null }): boolean {
  const country = (row.country ?? "").trim();
  if (/^(美国|英国|欧盟|日本|韩国|印度|澳洲|澳大利亚|加拿大|US|USA|UK|EU|JP|KR)$/i.test(country)) return false;
  if (FOREIGN_SOURCE.test(row.source_name) || FOREIGN_SOURCE.test(row.title)) return false;
  if (/^(中国|CN|China)$/i.test(country)) return true;
  // 信源名带中文（中新网、芥末堆、中国教育在线等）视为国内；纯英文信源即使标题译成中文也不收录。
  if (/[\u4e00-\u9fff]/.test(row.source_name)) return true;
  return false;
}

function isPolicy(row: { tags: string[]; topic: string | null; section: string | null; type: string | null }): boolean {
  if (row.section === "policy") return true;
  if (POLICY_TAG.test(row.topic ?? "") || POLICY_TYPE.test(row.type ?? "")) return true;
  return (row.tags ?? []).some((tag) => POLICY_TAG.test(tag) || tag === "政策/监管");
}

export function isConsultationDraft(title: string, extra = ""): boolean {
  return /征求意见稿|公开征求意见/.test(`${title} ${extra}`);
}

/** 2026-04 全国五部门《人工智能+教育》行动计划，不是窗口内新发文。云南/甘肃等省级方案保留。 */
export function isNationalAprilAiEduPlan(title: string): boolean {
  const t = title.replace(/\s+/g, "");
  if (/云南|甘肃|河南|湖南|浙江|江苏|四川|北京|上海|广东|山东|省级/.test(t)) return false;
  return /人工智能\+教育/.test(t) && /行动计划/.test(t);
}

export function policyEventKey(title: string, url: string): string {
  const t = title.replace(/\s+/g, "");
  if (/河南/.test(t) && /实施意见/.test(t)) return "henan-ai-edu";
  if (/云南/.test(t) && /人工智能\+教育|行动方案/.test(t)) return "yunnan-ai-edu";
  if (/湖南/.test(t) && /人工智能/.test(t)) return "hunan-ai-edu";
  if (/甘肃/.test(t) && /人工智能\+教育|行动计划/.test(t)) return "gansu-ai-edu";
  if (/教师/.test(t) && /(素养|数字素养)/.test(t) && /培训|全覆盖/.test(t)) return "moe-teacher-ai";
  // 只合并「教育部在烟台召开的双减推进会」报道。旧条件是 /双减/ 且 /推进会|烟台/，
  // 任意带「双减」「推进会」的会议（如全国校外培训行政执法经验交流推进会）会被误并到烟台那场。
  if (/双减/.test(t) && /烟台/.test(t)) return "shuangjian-yantai";
  if (/征求意见稿/.test(t) && /未成年人/.test(t)) return "cac-minors-draft";
  if (isNationalAprilAiEduPlan(title)) return "national-ai-edu-plan-2026-04";
  return url;
}

export interface PolicyUpdateItem {
  id: string;
  title: string;
  url: string;
  date: string;
  source: string;
  unverified: boolean;
  consultationDraft: boolean;
  summary?: string;
  publishedAt?: string;
}

export async function loadPolicyUpdatesPage(now = new Date()) {
  const since = windowStartDay(now, COMPANY_LOOKBACK_DAYS);
  const today = beijingDate(now);
  const tagMap = loadContentTagMap();

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
    body_status: string | null;
    visibility: string | null;
    country: string | null;
    section: string | null;
    type: string | null;
    brief: string | null;
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
           a.body_status,
           p.visibility,
           a.raw->>'country' AS country,
           a.raw->>'section' AS section,
           coalesce(a.raw->>'信源类型', a.raw->>'分类') AS type,
           a.raw->>'brief' AS brief
    FROM articles a
    LEFT JOIN publications p ON p.article_id = a.id
    LEFT JOIN sources s ON s.id = coalesce(p.source_id, a.source_id)
    WHERE (p.article_id IS NULL OR (p.visibility = 'public' AND p.channel = 'news'))
      AND (
        (a.publication_time ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' AND a.publication_time >= ${since})
        OR (coalesce(p.published_at, a.published_at) IS NOT NULL
            AND coalesce(p.published_at, a.published_at) >= (${since}::date - interval '1 day'))
      )
  `;

  const candidates: Array<PolicyUpdateItem & { eventKey: string; fromBackfill: boolean }> = [];
  const seenUrl = new Set<string>();
  for (const row of rows) {
    if (row.visibility && row.visibility !== "public") continue;
    const fromBackfill = row.section === "policy" || row.brief === "policy-backfill";
    const day = articleDay(row.publication_time, row.published_at);
    if (!day || day < since || day > today) continue;
    if (isNationalAprilAiEduPlan(row.title)) continue;
    const check = originChecked(row.verify, row.body_status, row.summary, row.title);
    if (!check.ok) continue;
    // 栏目以 policy-backfill 为准；站内/雷达同题帖只在没有补录版本时才考虑（后面按事件去重，优先已核对的补录）。
    if (!fromBackfill) continue;
    if (!isDomestic({ source_name: row.source_name, title: row.title, country: row.country })) continue;
    const title = scrubPublic(row.title);
    const source = scrubPublic(publicSourceName(row.source_name));
    if (!title) continue;
    if (seenUrl.has(row.id) || seenUrl.has(row.url)) continue;
    seenUrl.add(row.id);
    seenUrl.add(row.url);
    candidates.push({
      id: row.id,
      title,
      url: row.url,
      date: day,
      source,
      unverified: check.unverified,
      consultationDraft: isConsultationDraft(title, `${row.summary ?? ""} ${row.type ?? ""}`),
      summary: publicSummary(row.summary, title),
      publishedAt: publicPublishedAt(row.published_at),
      eventKey: policyEventKey(title, row.url),
      fromBackfill,
    });
  }
  // 同一政策事件只留一条：补录优先，已核对原文优先，日期较新优先。
  const byEvent = new Map<string, (typeof candidates)[number]>();
  const rank = (x: (typeof candidates)[number]) => (x.fromBackfill ? 2 : 0) + (x.unverified ? 0 : 1);
  for (const item of candidates) {
    const prev = byEvent.get(item.eventKey);
    if (!prev || rank(item) > rank(prev) || (rank(item) === rank(prev) && item.date > prev.date)) {
      byEvent.set(item.eventKey, item);
    }
  }
  const items: PolicyUpdateItem[] = [...byEvent.values()]
    .map(({ eventKey: _k, fromBackfill: _f, ...item }) => item)
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));

  return {
    asOf: today,
    since,
    section: "国内政策",
    items,
  };
}
