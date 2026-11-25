// Planning and one-row import for an industry brief CSV. The CLI in import-brief-items.ts
// discovers files and calls importOneBriefItem. Loading this module does not import a file.
import { beijingMidnight } from "@aihot/contracts/time";
import { parseOriginalDateline } from "@aihot/industry/dateline";
import { sql } from "@aihot/backend/db";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { queueProcessing } from "@aihot/backend/jobs/content";

/** Same bound as STALE_ON_DISCOVERY_MS. This module does not import materials.ts, which opens more of the backend. */
export const BRIEF_STALE_MS = 48 * 3600 * 1000;

export type BriefSlot = "featured" | "archive" | "older" | "undated";

export interface BriefPublicationPlan {
  /** 原发日, or null when the cell is empty or not a real dateline. */
  day: string | null;
  /** Trimmed cell, including text that was refused. */
  evidence: string | null;
  publishedAt: Date | null;
  /** Evidence stored on the article. Null when the cell is not a legal dateline. */
  publicationTime: string | null;
  /**
   * Explicit backfill tag. The date inside it is 导入日 (the brief file), not 原发日.
   * Null when the original day is known and was not already more than 48 hours before `now`.
   */
  backfill: string | null;
  slot: BriefSlot;
}

/**
 * `briefDate` is 导入日. `now` is the moment of this import, used as 发现日 by importOneBriefItem.
 * Neither is written into published_at.
 */
export function planBriefPublication(raw: string | null | undefined, briefDate: string, now: Date): BriefPublicationPlan {
  const evidence = (raw ?? "").trim() || null;
  const parsed = parseOriginalDateline(raw);
  if (!parsed) {
    return {
      day: null,
      evidence,
      publishedAt: null,
      publicationTime: null,
      backfill: `brief-${briefDate}-undated`,
      slot: "undated",
    };
  }
  const ageMs = now.getTime() - parsed.publishedAt.getTime();
  return {
    day: parsed.day,
    evidence: parsed.evidence,
    publishedAt: parsed.publishedAt,
    publicationTime: parsed.evidence,
    backfill: ageMs > BRIEF_STALE_MS ? `brief-${briefDate}` : null,
    slot: slotFor(parsed.day, briefDate),
  };
}

function slotFor(day: string, briefDate: string): BriefSlot {
  const age = Math.round((beijingMidnight(briefDate).getTime() - beijingMidnight(day).getTime()) / 86400000);
  if (age <= 7) return "featured";
  if (age <= 30) return "archive";
  return "older";
}

// The CSV's 叫叫英语 URL is already a different 多知 weekly in the DB. The same
// story already exists at 2026110618957. Do not overwrite the weekly.
const SKIP_URLS = new Set(["http://www.duozhi.com/industry/insight/2026110818961.shtml"]);

const SOURCE_BY_MEDIA: Record<string, { id: string; name: string; existing?: boolean }> = {
  "Boston.com": { id: "ext-boston-com", name: "Boston.com" },
  "Yahoo Finance": { id: "ext-yahoo-finance", name: "Yahoo Finance" },
  "中国商务新闻网": { id: "ext-businessnews-cn", name: "中国商务新闻网" },
  "多知": { id: "web-duozhi", name: "多知", existing: true },
  "新浪财经": { id: "ext-sina-finance", name: "新浪财经" },
  "新浪财经（来源中国网）": { id: "ext-sina-finance", name: "新浪财经" },
  "新浪（重庆）": { id: "ext-sina-finance", name: "新浪财经" },
  "凤凰网": { id: "ext-ifeng", name: "凤凰网" },
  "Renascence": { id: "ext-renascence", name: "Renascence" },
  "Tes": { id: "ext-tes", name: "Tes" },
  "Six State Signal": { id: "ext-six-state-signal", name: "Six State Signal" },
  "Mojo Nation": { id: "ext-mojo-nation", name: "Mojo Nation" },
  "Just Raised": { id: "ext-just-raised", name: "Just Raised" },
  "VentureSquare": { id: "ext-venturesquare", name: "VentureSquare" },
  "中国家电网": { id: "ext-cheaa", name: "中国家电网" },
  "芥末堆": { id: "rss-jiemodui", name: "芥末堆", existing: true },
  "中国教育在线": { id: "ext-eol", name: "中国教育在线" },
  "中国教育在线（来源四川省教育厅）": { id: "ext-eol", name: "中国教育在线" },
  "36氪": { id: "ext-36kr-aix", name: "36氪" },
  "36氪（开智学堂）": { id: "ext-36kr-aix", name: "36氪" },
  "东方财富财富号": { id: "ext-eastmoney-iflytek", name: "东方财富财富号" },
};

function sourceFor(media: string): { id: string; name: string; existing?: boolean } | null {
  const trimmed = media.trim();
  if (!trimmed) return null;
  if (SOURCE_BY_MEDIA[trimmed]) return SOURCE_BY_MEDIA[trimmed]!;
  const slim = trimmed.replace(/（.*?）/g, "").trim();
  if (slim && SOURCE_BY_MEDIA[slim]) return SOURCE_BY_MEDIA[slim]!;
  const slug = slim.toLowerCase().replace(/[^a-z0-9一-鿿]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "media";
  return { id: `ext-brief-${slug}`, name: slim || trimmed };
}

async function ensureSource(id: string, name: string, existing?: boolean) {
  if (existing) {
    const [row] = await sql<{ id: string }[]>`SELECT id FROM sources WHERE id = ${id}`;
    if (!row) throw new Error(`missing existing source ${id}`);
    return;
  }
  await sql`
    INSERT INTO sources (id, name, kind, config, tags, first_party, tier, participation_mode, interval_minutes, enabled, uses)
    VALUES (${id}, ${name}, ${"external"}, ${sql.json({} as never)}, ${[] as string[]}, ${false}, ${"T2"}, ${"editorial"}, ${180}, ${false}, ${[] as string[]})
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, kind = EXCLUDED.kind, enabled = false, updated_at = now()`;
}

export interface BriefItemResult {
  title: string;
  url: string;
  day: string | null;
  slot: BriefSlot;
  articleId?: string;
  created?: boolean;
  revised: boolean;
  queued: boolean;
  failed: boolean;
  skipped?: string;
}

/**
 * Insert one brief row. An existing URL is left unchanged, including a row the old dateline rule
 * stored without a publication day. `now` is both the age clock and 发现日.
 */
export async function importOneBriefItem(input: {
  row: Record<string, string>;
  url: string;
  norm: string;
  briefDate: string;
  now?: Date;
}): Promise<BriefItemResult> {
  const now = input.now ?? new Date();
  const r = input.row;
  const { url, norm, briefDate } = input;
  const title = (r["标题"] || "").trim();
  const media = (r["媒体"] || "").trim();
  const rawDay = (r["落款日期"] || "").trim() || null;
  const plan = planBriefPublication(rawDay, briefDate, now);
  const facts = (r["事实摘要"] || "").trim();
  const infer = (r["推断"] || "").trim();
  const verify = (r["核验状态"] || "").trim();
  const body = [facts, infer ? `推断：${infer}` : "", verify ? `核验：${verify}` : ""].filter(Boolean).join("\n");
  const src = sourceFor(media);
  const base: BriefItemResult = { title, url, day: rawDay, slot: plan.slot, revised: false, queued: false, failed: false };
  if (!url || !title || !src) {
    return { ...base, failed: true, skipped: !src ? `unknown media ${media}` : "missing url/title" };
  }
  if (SKIP_URLS.has(url) || SKIP_URLS.has(norm)) {
    return { ...base, skipped: "url already holds a different article; 绿豆豆 story is 2026110618957" };
  }
  const [existing] = await sql<{ id: string }[]>`
    SELECT id FROM articles
    WHERE url = ${url} OR url = ${norm}
       OR regexp_replace(url, '#.*$', '') = ${norm}
    LIMIT 1`;
  if (existing) {
    return { ...base, articleId: existing.id, skipped: "duplicate url" };
  }
  await ensureSource(src.id, src.name, src.existing);
  const res = await upsertMaterial({
    sourceId: src.id,
    url,
    title,
    language: "zh",
    publishedAt: plan.publishedAt,
    publicationTime: plan.publicationTime,
    discoveredAt: now,
    excerpt: facts ? facts.slice(0, 280) : null,
    bodyText: body || null,
    bodyStatus: body.length >= 80 ? "ok" : body ? "unconfirmed" : "pending",
    via: "import",
    backfill: plan.backfill,
    raw: { brief: `daily-${briefDate}`, media, verify, country: r["国家"] || "", age: r["学生年龄段"] || "" },
  });
  let queued = false;
  if (res.created || res.revised || res.processingNeeded) {
    if (await queueProcessing(res.articleId)) queued = true;
  }
  return { ...base, articleId: res.articleId, created: res.created, revised: res.revised, queued, skipped: queued ? undefined : "not queued" };
}
