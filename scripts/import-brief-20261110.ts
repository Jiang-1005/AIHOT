// Import the 2026-11-10 industry brief (items.csv) as editorial materials.
// Disabled external sources only — does not change the 23 official collectors.
// Usage: docker exec -w /app xintian-edu-hot-api-1 node /app/scripts/import-brief-20261110.ts
import { readFileSync } from "node:fs";
import { beijingMidnight } from "@aihot/contracts/time";
import { installModules } from "@aihot/backend/modules";
import { closeDb, sql } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { queueProcessing } from "@aihot/backend/jobs/content";
import { SERVER_MODULES } from "@aihot/site/modules/server";

installModules(SERVER_MODULES);

const CSV = process.argv[2] ?? "/data/brief-20261110-items.csv";

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

function normalizeUrl(url: string): string {
  return url.trim().replace(/#.*$/, "");
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.length);
  if (!lines.length) return [];
  const headers = splitCsvLine(lines[0]!);
  const rows: Record<string, string>[] = [];
  for (const line of lines.slice(1)) {
    const cols = splitCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = cols[i] ?? ""; });
    rows.push(row);
  }
  return rows;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
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

const csvText = readFileSync(CSV, "utf8");
const rows = parseCsv(csvText);
const summary = {
  csv: rows.length,
  skippedExistingWrongTitle: [] as string[],
  created: 0,
  revised: 0,
  queued: 0,
  failed: 0,
  items: [] as Array<{ title: string; url: string; day: string | null; slot: string; articleId?: string; created?: boolean; skipped?: string }>,
};

const today = "2026-11-10";
function slotOf(day: string | null): string {
  if (!day) return "undated";
  const age = Math.round((beijingMidnight(today).getTime() - beijingMidnight(day).getTime()) / 86400000);
  if (age <= 7) return "featured";
  if (age <= 30) return "archive";
  return "older";
}

for (const r of rows) {
  const url = (r["原文链接"] || "").trim();
  const title = (r["标题"] || "").trim();
  const media = (r["媒体"] || "").trim();
  const day = (r["落款日期"] || "").trim() || null;
  const facts = (r["事实摘要"] || "").trim();
  const infer = (r["推断"] || "").trim();
  const verify = (r["核验状态"] || "").trim();
  const body = [facts, infer ? `推断：${infer}` : "", verify ? `核验：${verify}` : ""].filter(Boolean).join("\n");
  const src = sourceFor(media);
  const slot = slotOf(day);
  if (!url || !title || !src) {
    summary.failed += 1;
    summary.items.push({ title, url, day, slot, skipped: !src ? `unknown media ${media}` : "missing url/title" });
    continue;
  }
  if (SKIP_URLS.has(url) || SKIP_URLS.has(normalizeUrl(url))) {
    summary.skippedExistingWrongTitle.push(url);
    summary.items.push({ title, url, day, slot, skipped: "url already holds a different article; 绿豆豆 story is 2026110618957" });
    continue;
  }
  try {
    const norm = normalizeUrl(url);
    const [existing] = await sql<{ id: string; title: string; url: string }[]>`
      SELECT id, title, url FROM articles
      WHERE url = ${url} OR url = ${norm}
         OR regexp_replace(url, '#.*$', '') = ${norm}
      LIMIT 1`;
    if (existing) {
      summary.skippedExistingWrongTitle.push(url);
      summary.items.push({ title, url, day, slot, articleId: existing.id, skipped: "duplicate url" });
      continue;
    }
    await ensureSource(src.id, src.name, src.existing);
    const publishedAt = day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? beijingMidnight(day) : null;
    const ageMs = publishedAt ? Date.now() - publishedAt.getTime() : null;
    const explicitBackfill = publishedAt && ageMs != null && ageMs > 48 * 3600 * 1000 ? "brief-2026-11-10" : (!publishedAt ? "brief-2026-11-10-undated" : null);
    const res = await upsertMaterial({
      sourceId: src.id,
      url,
      title,
      language: "zh",
      publishedAt,
      publicationTime: day,
      excerpt: facts ? facts.slice(0, 280) : null,
      bodyText: body || null,
      bodyStatus: body.length >= 80 ? "ok" : body ? "unconfirmed" : "pending",
      via: "import",
      backfill: explicitBackfill,
      raw: { brief: "daily-2026-11-10", media, verify, country: r["国家"] || "", age: r["学生年龄段"] || "" },
    });
    if (res.created) summary.created += 1;
    if (res.revised) summary.revised += 1;
    let queued = false;
    if (res.created || res.revised || res.processingNeeded) {
      if (await queueProcessing(res.articleId)) {
        summary.queued += 1;
        queued = true;
      }
    }
    summary.items.push({ title, url, day, slot, articleId: res.articleId, created: res.created, skipped: queued ? undefined : "not queued" });
  } catch (err) {
    summary.failed += 1;
    summary.items.push({ title, url, day, slot, skipped: (err as Error).message });
    console.error("FAIL", url, (err as Error).message);
  }
}

const featured = summary.items.filter((i) => i.slot === "featured" && !i.skipped).length;
const archive = summary.items.filter((i) => i.slot === "archive" && !i.skipped).length;
const undated = summary.items.filter((i) => i.slot === "undated").length;
console.log(JSON.stringify({ ...summary, dateSlots: { featured, archive, undated, skipped: summary.skippedExistingWrongTitle.length } }, null, 2));
await stopBoss();
await closeDb();
