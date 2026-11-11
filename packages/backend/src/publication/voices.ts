// 「社区热帖」: parent / teacher / student / KOL voices, kept out of media 精选.
// The catalog is AIHOT_DATA_DIR/voices.json (shape: VoicesCatalog below), or the site_blobs copy on Vercel.
// The importer that builds it from community posts is not part of this public repository.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { config, REPO_ROOT } from "../config.ts";
import { HIDDEN_PUBLIC_TERMS, publicCopy, publicText } from "@aihot/site/public-copy";
import { formatDataAsOf, loadSiteSync } from "./site-blobs.ts";

export interface VoiceMetrics {
  likes?: number | string | null;
  reposts?: number | string | null;
  replies?: number | string | null;
  quotes?: number | string | null;
  bookmarks?: number | string | null;
  views?: number | string | null;
  collects?: number | string | null;
  comments?: number | string | null;
  captured_at?: string | null;
  metrics_fetched_at?: string | null;
  caption?: string | null;
}

export interface VoiceTags {
  topic: string;
  subject: string;
  subject_raw?: string;
  companies: string[];
  form: string;
  content_type: string;
}

export interface VoiceCard {
  id: string;
  platform: string;
  url: string;
  author: string;
  poster: string;
  source?: string;
  published_at: string | null;
  day: string | null;
  slot: "featured" | "archive";
  age_days: number | null;
  age_range: string;
  country: string;
  metrics: VoiceMetrics;
  title: string;
  brief?: string | null;
  quote: string;
  summary?: string | null;
  why: string;
  verified: boolean;
  unverified_label?: string | null;
  identity_unconfirmed?: boolean;
  tags?: VoiceTags;
  tags_source?: string | null;
}

export interface VoicesCatalog {
  generatedAt: string;
  asOf: string;
  section: string;
  items: VoiceCard[];
  counts: { featured: number; archive: number; total?: number };
  report: Record<string, unknown>;
}

export interface LogoEntry {
  name: string;
  path: string;
  source_url?: string;
}

const CATALOG = path.join(config.dataDir, "voices.json");
const LOGO_SOURCES = [
  path.join(config.dataDir, "logos/sources.json"),
  "/app/apps/web/public/logos/sources.json",
  path.join(path.resolve(config.dataDir, ".."), "apps/web/public/logos/sources.json"),
];

export function loadLogoIndex(): { index: Record<string, string>; missing: string[]; items: LogoEntry[] } {
  for (const p of LOGO_SOURCES) {
    try {
      if (!existsSync(p)) continue;
      const raw = JSON.parse(readFileSync(p, "utf8")) as {
        index?: Record<string, string>;
        items?: Array<{ name: string; path: string; source_url?: string }>;
        missing?: Array<{ name: string }>;
      };
      const index = { ...(raw.index ?? {}) };
      for (const it of raw.items ?? []) {
        if (it.name && it.path) index[it.name] = it.path;
      }
      return {
        index,
        missing: (raw.missing ?? []).map((m) => m.name),
        items: (raw.items ?? []).map((it) => ({ name: it.name, path: it.path, source_url: it.source_url })),
      };
    } catch {
      /* try next */
    }
  }
  return { index: {}, missing: [], items: [] };
}

export function loadVoicesCatalog(): VoicesCatalog {
  try {
    const raw = readFileSync(CATALOG, "utf8");
    const cat = JSON.parse(raw) as VoicesCatalog;
    cat.section = cat.section || "社区热帖";
    return cat;
  } catch {
    return {
      generatedAt: "",
      asOf: "",
      section: "社区热帖",
      items: [],
      counts: { featured: 0, archive: 0, total: 0 },
      report: {},
    };
  }
}

export const HEAD_COMPANIES = [
  "好未来", "学而思", "新东方", "猿辅导", "作业帮", "有道", "讯飞", "高途", "豆神", "洋葱学园", "叫叫",
  "Duolingo", "Khan Academy", "Chegg", "Quizlet", "Speak",
] as const;

export const FACET_VOCAB = {
  topic: ["公司与资本", "产品与功能", "政策与合规", "研究与证据", "教学实践", "观点与趋势"],
  subject: ["表达与口语", "阅读写作", "绘本伴读", "情商与SEL", "英语", "数理与提分", "全科通用", "不涉及"],
  form: ["App与网页", "大模型学习模式", "教师工具与平台", "学习机与平板", "词典笔与点读绘本机", "AI玩具与陪伴设备", "服务（线下或真人+AI）", "不涉及"],
  content_type: ["新闻快讯", "官方发布", "深度分析", "测评体验", "研究报告", "观点评论", "教程与提示词", "用户自述"],
} as const;


const HIDDEN_COMPANIES = new Set(HIDDEN_PUBLIC_TERMS);

function publicVoiceTags(tags: VoiceTags | undefined): VoiceTags | undefined {
  if (!tags) return undefined;
  const companies = (tags.companies ?? [])
    .map((c) => publicCopy(c))
    .filter((c) => c && !HIDDEN_COMPANIES.has(c));
  return {
    topic: publicCopy(tags.topic) || tags.topic,
    subject: publicCopy(tags.subject) || tags.subject,
    ...(tags.subject_raw ? { subject_raw: publicCopy(tags.subject_raw) || tags.subject_raw } : {}),
    companies,
    form: publicCopy(tags.form) || tags.form,
    content_type: publicCopy(tags.content_type) || tags.content_type,
  };
}

/** Public voice card: only the fields a page may render; internal catalog extras stay off the wire. */
export function toPublicVoiceCard(it: VoiceCard): VoiceCard {
  return {
    id: it.id,
    platform: it.platform,
    url: it.url,
    author: publicCopy(it.author),
    poster: publicCopy(it.poster),
    ...(it.source ? { source: publicCopy(it.source) || it.source } : {}),
    published_at: it.published_at,
    day: it.day,
    slot: it.slot,
    age_days: it.age_days,
    age_range: it.age_range,
    country: it.country,
    metrics: {
      likes: it.metrics?.likes,
      reposts: it.metrics?.reposts,
      replies: it.metrics?.replies,
      quotes: it.metrics?.quotes,
      bookmarks: it.metrics?.bookmarks,
      views: it.metrics?.views,
      collects: it.metrics?.collects,
      comments: it.metrics?.comments,
      captured_at: it.metrics?.captured_at,
      metrics_fetched_at: it.metrics?.metrics_fetched_at,
      caption: publicText(it.metrics?.caption ?? null),
    },
    title: publicCopy(it.title) || it.title,
    brief: publicText(it.brief),
    quote: publicCopy(it.quote) || it.quote,
    summary: publicText(it.summary),
    why: publicCopy(it.why),
    verified: it.verified,
    ...(it.unverified_label ? { unverified_label: publicCopy(it.unverified_label) || it.unverified_label } : {}),
    ...(it.identity_unconfirmed ? { identity_unconfirmed: true } : {}),
    ...(it.tags ? { tags: publicVoiceTags(it.tags) } : {}),
    ...(it.tags_source ? { tags_source: it.tags_source } : {}),
  };
}

export function loadVoicesPage() {
  const catalog = loadVoicesCatalog();
  const logos = loadLogoIndex();
  const last7 = catalog.items.filter((i) => (i.age_days ?? 99) <= 7).length;
  return {
    catalog: {
      generatedAt: catalog.generatedAt,
      asOf: catalog.asOf,
      section: "社区热帖",
      counts: {
        featured: catalog.counts.featured,
        archive: catalog.counts.archive,
        total: catalog.items.length,
        last7,
      },
    },
    items: catalog.items.map(toPublicVoiceCard),
    vocab: FACET_VOCAB,
    headCompanies: [...HEAD_COMPANIES],
    logos,
    // 「数据截至」is the last successful sync-to-neon.sh time, not a per-item metrics fetch.
    dataAsOf: (() => {
      const stamp = loadSiteSync()?.syncedAt;
      return stamp ? formatDataAsOf(stamp) : "";
    })(),
  };
}
