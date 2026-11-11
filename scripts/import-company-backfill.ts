// Import 国内公司动态 / 国内政策 backfill CSVs (daily 12 columns, optional 13th 「公司」).
// Reads every items-backfill*.csv and policy-backfill*.csv under the briefing dirs
// (including rows appended to items-backfill.csv).
// Policy rows are recognized by filename (policy-backfill*) or 信源类型 / 分类. Dedupe by 原文链接. Idempotent.
// Does not change 精选门槛 and never sets selected=true.
// CSV 里多出来的内部备注列不写入公开输出。
// Existing selected publications are not rewritten.
//
// Usage (from the repo root; the folder holds items-backfill*.csv / policy-backfill*.csv):
//   docker cp ./backfill/. edu-hot-api-1:/tmp/backfill/
//   docker exec -w /app -e COMPANY_BACKFILL_DIR=/tmp/backfill edu-hot-api-1 node /app/scripts/import-company-backfill.ts
//   node --import ./scripts/neon-doh-dns.mjs scripts/import-company-backfill.ts   # host, if DATABASE_URL is set
import { existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { installModules } from "@aihot/backend/modules";
import { closeDb, sql } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { config } from "@aihot/backend/config";
import { beijingDate, beijingTime } from "@aihot/contracts/time";
import { mapCompanyLabel, COMPANY_ROSTER, sameCompanyEvent, preferCompanyEventItem, isCommunityVoiceItem } from "@aihot/backend/publication/company-updates";
import { rowLooksLikePolicy } from "@aihot/backend/publication/policy-updates";
import { SERVER_MODULES } from "@aihot/site/modules/server";

installModules(SERVER_MODULES);

const BACKFILL_NAME = /^(items-backfill.*|policy-backfill.*)\.csv$/i;

function defaultDirs(): string[] {
  const dirs = [
    process.env.COMPANY_BACKFILL_DIR,
    "/data",
    "/tmp",
  ].filter((p): p is string => !!p);
  for (const file of [process.env.COMPANY_BACKFILL_CSV, process.argv[2]]) {
    if (!file) continue;
    dirs.unshift(existsSync(file) && !file.toLowerCase().endsWith(".csv") ? file : path.dirname(file));
  }
  return [...new Set(dirs)];
}

function resolveCsvs(): string[] {
  const found = new Map<string, string>();
  for (const dir of defaultDirs()) {
    if (!existsSync(dir)) continue;
    let names: string[] = [];
    try { names = readdirSync(dir); } catch { continue; }
    for (const name of names) {
      if (!BACKFILL_NAME.test(name)) continue;
      const full = path.resolve(dir, name);
      try { found.set(realpathSync(full), full); }
      catch { found.set(full, full); }
    }
  }
  for (const file of [process.env.COMPANY_BACKFILL_CSV, process.argv[2]]) {
    if (file && existsSync(file) && file.toLowerCase().endsWith(".csv")) {
      try { found.set(realpathSync(file), path.resolve(file)); }
      catch { found.set(path.resolve(file), path.resolve(file)); }
    }
  }
  const list = [...found.values()].sort();
  if (!list.length) {
    throw new Error(`No backfill CSV found (items-backfill*.csv / policy-backfill*.csv). Looked in: ${defaultDirs().join(", ")}`);
  }
  return list;
}

const SOURCE_BY_MEDIA: Record<string, { id: string; name: string; existing?: boolean }> = {
  "多知": { id: "web-duozhi", name: "多知", existing: true },
  "腾讯财经": { id: "ext-qq-finance", name: "腾讯财经" },
  "人民政协网": { id: "ext-rmzxw", name: "人民政协网" },
  "36氪（AIX财经）": { id: "ext-36kr-aix", name: "36氪" },
  "36氪": { id: "ext-36kr-aix", name: "36氪" },
  "东方财富财富号（科大讯飞）": { id: "ext-eastmoney-iflytek", name: "东方财富财富号" },
  "新快报": { id: "ext-xkb", name: "新快报" },
  "中国日报网（转鲁网）": { id: "ext-chinadaily", name: "中国日报网" },
  "中国日报网": { id: "ext-chinadaily", name: "中国日报网" },
  "中国山东网（搜狐转载）": { id: "ext-sohu-sd", name: "中国山东网" },
  "中国山东网": { id: "ext-sohu-sd", name: "中国山东网" },
  "大江网（转中国日报网）": { id: "ext-jxnews", name: "大江网" },
  "大江网": { id: "ext-jxnews", name: "大江网" },
  "中国商务新闻网": { id: "ext-businessnews-cn", name: "中国商务新闻网" },
  "新浪财经": { id: "ext-sina-finance", name: "新浪财经" },
  "中国家电网": { id: "ext-cheaa", name: "中国家电网" },
  "网经社": { id: "ext-100ec", name: "网经社" },
  "教育部": { id: "ext-moe", name: "教育部" },
  "中国政府网": { id: "ext-gov-cn", name: "中国政府网" },
  "新华社": { id: "ext-xinhua", name: "新华社" },
  "新华网": { id: "ext-xinhua-net", name: "新华网" },
  "人民日报": { id: "ext-people", name: "人民日报" },
  "中国教育报": { id: "ext-jyb", name: "中国教育报" },
  "中国教育新闻网": { id: "ext-jyb-news", name: "中国教育新闻网" },
  "中新网": { id: "ext-chinanews", name: "中新网" },
  "中国教育在线": { id: "ext-eol", name: "中国教育在线" },
  "芥末堆": { id: "rss-jiemodui", name: "芥末堆", existing: true },
  "澎湃新闻": { id: "ext-thepaper", name: "澎湃新闻" },
  "澎湃": { id: "ext-thepaper", name: "澎湃新闻" },
  "经济网": { id: "ext-ceweekly", name: "经济网" },
  "广州日报（大洋网）": { id: "ext-dayoo", name: "广州日报" },
  "广州日报": { id: "ext-dayoo", name: "广州日报" },
  "中国证券报·中证网": { id: "ext-cs-cn", name: "中证网" },
  "中证网": { id: "ext-cs-cn", name: "中证网" },
  "新京报": { id: "ext-bjnews", name: "新京报" },
  "新京报（新浪财经转载）": { id: "ext-bjnews", name: "新京报" },
  "河北青年报（新华报业网转载）": { id: "ext-xhby", name: "河北青年报" },
  "光明网": { id: "ext-gmw", name: "光明网" },
  "新华网": { id: "ext-xinhua-net", name: "新华网" },
  "星岛环球网（转快科技，据新浪科技）": { id: "ext-stnn", name: "星岛环球网" },
  "星岛环球网": { id: "ext-stnn", name: "星岛环球网" },
  "科技日报": { id: "ext-stdaily", name: "科技日报" },
  "教育在线（稿件来源栏标注教育部）": { id: "ext-eol", name: "中国教育在线" },
  "教育在线": { id: "ext-eol", name: "中国教育在线" },
  "中国教育报（中国青年网转载）": { id: "ext-jyb", name: "中国教育报" },
  "山东教育新闻网（来源：教育部网站）": { id: "ext-sdjyxww", name: "山东教育新闻网" },
  "山东教育新闻网": { id: "ext-sdjyxww", name: "山东教育新闻网" },
  "同花顺（转智通财经）": { id: "ext-10jqka", name: "同花顺" },
  "同花顺": { id: "ext-10jqka", name: "同花顺" },
  "中国教育在线（来源栏标注云南省教育厅）": { id: "ext-eol", name: "中国教育在线" },
  "中国网信网": { id: "ext-cac", name: "中国网信网" },
  "澎湃号·媒体（濮阳网）": { id: "ext-thepaper", name: "澎湃新闻" },
  "澎湃号": { id: "ext-thepaper", name: "澎湃新闻" },
};



function sourceFor(media: string): { id: string; name: string; existing?: boolean } | null {
  const trimmed = media.trim();
  if (!trimmed) return null;
  if (SOURCE_BY_MEDIA[trimmed]) return SOURCE_BY_MEDIA[trimmed]!;
  const slim = trimmed.replace(/（.*?）/g, "").trim();
  if (slim && SOURCE_BY_MEDIA[slim]) return SOURCE_BY_MEDIA[slim]!;
  const slug = slim.toLowerCase().replace(/[^a-z0-9一-鿿]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "media";
  return { id: `ext-backfill-${slug}`, name: slim || trimmed };
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

function companiesOf(row: Record<string, string>): { id: string; name: string }[] {
  const explicit = (row["公司"] || "").trim();
  const hay = [explicit, row["标题"] || "", row["事实摘要"] || ""].join("\n");
  const hits: { id: string; name: string }[] = [];
  const seen = new Set<string>();
  if (explicit) {
    for (const part of explicit.split(/[、,，;；/]+/)) {
      const mapped = mapCompanyLabel(part.trim());
      if (mapped && !seen.has(mapped.id)) { seen.add(mapped.id); hits.push(mapped); }
    }
  }
  if (!hits.length) {
    for (const company of COMPANY_ROSTER) {
      if (seen.has(company.id)) continue;
      if (company.aliases.some((a) => a.length >= 2 && hay.includes(a))) {
        seen.add(company.id);
        hits.push(company);
      }
    }
  }
  return hits;
}

function contentTagsPath(): string {
  return path.join(config.dataDir, "content-tags.json");
}

function mergeContentTags(entries: Array<{ id: string; url: string; title: string; companies: string[]; topic?: string; source?: string }>) {
  const file = contentTagsPath();
  let current: { generatedAt?: string; items?: Record<string, Record<string, unknown>> } = { items: {} };
  if (existsSync(file)) {
    try { current = JSON.parse(readFileSync(file, "utf8")); } catch { /* start fresh-ish */ }
  }
  if (!current.items || typeof current.items !== "object") current.items = {};
  const now = `${beijingDate(new Date())} ${beijingTime(new Date())}`;
  current.generatedAt = now;
  for (const entry of entries) {
    const prev = (current.items[entry.id] ?? current.items[entry.url] ?? {}) as Record<string, unknown>;
    const companies = [...new Set([...(Array.isArray(prev.companies) ? prev.companies as string[] : []), ...entry.companies])];
    const rec = {
      id: entry.id,
      url: entry.url,
      title: entry.title,
      kind: "media",
      topic: entry.topic ?? prev.topic ?? "公司与资本",
      subject: prev.subject ?? "不涉及",
      subject_raw: prev.subject_raw ?? "不涉及",
      companies,
      form: prev.form ?? "不涉及",
      content_type: prev.content_type ?? "新闻快讯",
      source: entry.source ?? prev.source ?? "company-backfill",
      taggedAt: now,
    };
    current.items[entry.id] = rec;
    if (entry.url) current.items[entry.url] = rec;
  }
  writeFileSync(file, JSON.stringify(current, null, 2) + "\n");
  // Host run: also drop a copy into the api volume if that container is up.
  if (file !== "/data/content-tags.json") {
    const copied = spawnSync("docker", ["cp", file, `${process.env.API_CONTAINER ?? "edu-hot-api-1"}:/data/content-tags.json`], { encoding: "utf8" });
    if (copied.status !== 0) {
      console.error("content-tags.json written to", file, "(docker cp skipped)");
    }
  }
  return file;
}

async function ensurePublicListing(articleId: string, title: string, summary: string, url: string, tags: string[], publishedAt: Date | null, category = "行业动态") {
  const [article] = await sql<{
    id: string; source_id: string; discovered_at: Date; timeline_at: Date; published_at: Date | null; backfill: boolean;
  }[]>`SELECT id, source_id, discovered_at, timeline_at, published_at, backfill FROM articles WHERE id = ${articleId}`;
  if (!article) return;
  const [existing] = await sql<{ selected: boolean; tags: string[] }[]>`SELECT selected, tags FROM publications WHERE article_id = ${articleId}`;
  const mergedTags = [...new Set([...(existing?.tags ?? []), ...tags])];
  if (existing) {
    if (existing.selected) {
      await sql`UPDATE publications SET tags = ${mergedTags}::text[], updated_at = now() WHERE article_id = ${articleId}`;
    } else {
      const search = `${title}\n${summary}`.slice(0, 4000);
      await sql`UPDATE publications SET title = ${title}, summary = ${summary || null}, search_text = ${search}, tags = ${mergedTags}::text[], updated_at = now() WHERE article_id = ${articleId} AND selected = false`;
    }
    return;
  }
  const published = publishedAt ?? article.published_at;
  const search = `${title}\n${summary}`.slice(0, 4000);
  await sql`
    INSERT INTO publications (
      article_id, revision, visibility, eligible, selected, title, summary, category, tags,
      source_id, channel, first_party, url, published_at, discovered_at, timeline_at, backfill,
      body_mode, syndicate, indexable, search_text, updated_at, sort_at, seat, selection_candidate
    ) VALUES (
      ${articleId}, 1, ${"public"}, ${true}, ${false}, ${title}, ${summary || null}, ${category}, ${mergedTags}::text[],
      ${article.source_id}, ${"news"}, ${false}, ${url}, ${published}, ${article.discovered_at}, ${article.timeline_at}, ${true},
      ${"summary"}, ${false}, ${false}, ${search}, now(), ${published ?? article.timeline_at}, ${true}, ${false}
    )
    ON CONFLICT (article_id) DO NOTHING`;
}

const csvPaths = resolveCsvs();
type Incoming = { row: Record<string, string>; file: string; policy: boolean };
const byUrl = new Map<string, Incoming>();
for (const csvPath of csvPaths) {
  const fileName = path.basename(csvPath);
  for (const row of parseCsv(readFileSync(csvPath, "utf8"))) {
    const url = (row["原文链接"] || "").trim();
    if (!url) continue;
    const policy = rowLooksLikePolicy(row, fileName);
    const prev = byUrl.get(url);
    if (!prev) {
      byUrl.set(url, { row, file: csvPath, policy });
      continue;
    }
    prev.policy = prev.policy || policy;
    if ((row["公司"] || "").trim() && !(prev.row["公司"] || "").trim()) prev.row["公司"] = row["公司"]!;
    if (!(prev.row["核验状态"] || "").trim() && (row["核验状态"] || "").trim()) prev.row["核验状态"] = row["核验状态"]!;
  }
}

// 同一批 CSV 里，同一公司、相近日期、标题相似的事件只留一条：
// 来自 items-backfill*.csv 的补录优先（保留其原媒体链接），其次原媒体，再其次转载。
// 展示层还会再去重一次，所以库里已有的近重复不必在这里改写（避开晚轮写库窗口）。
{
  const entries = [...byUrl.entries()].filter(([, v]) => !v.policy);
  type Row = { id: string; url: string; title: string; date: string; source: string; unverified: boolean; companies: string[]; fromBackfill?: boolean };
  const rows: Row[] = [];
  for (const [url, v] of entries) {
    if (isCommunityVoiceItem({ url })) {
      byUrl.delete(url);
      continue;
    }
    rows.push({
      id: url,
      url,
      title: (v.row["标题"] || "").trim(),
      date: (v.row["落款日期"] || "").trim() || "9999-12-31",
      source: sourceFor((v.row["媒体"] || "").trim())?.name || (v.row["媒体"] || "").trim(),
      unverified: /未查到原文/.test(v.row["核验状态"] || ""),
      companies: companiesOf(v.row).map((c) => c.id),
      fromBackfill: /items-backfill/i.test(path.basename(v.file)),
    });
  }
  const parent = rows.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  const shareCompany = (a: Row, b: Row) => a.companies.some((id) => b.companies.includes(id));
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      if (!shareCompany(rows[i]!, rows[j]!)) continue;
      if (!sameCompanyEvent(rows[i]!, rows[j]!)) continue;
      const a = find(i);
      const b = find(j);
      if (a !== b) parent[b] = a;
    }
  }
  const groups = new Map<number, Row[]>();
  rows.forEach((row, i) => {
    const root = find(i);
    const group = groups.get(root) ?? [];
    group.push(row);
    groups.set(root, group);
  });
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const ranked = group.slice().sort((a, b) => preferCompanyEventItem(a, b) || a.url.localeCompare(b.url));
    for (const lose of ranked.slice(1)) byUrl.delete(lose.url);
  }
}

const summary = {
  csvs: csvPaths,
  created: 0,
  revised: 0,
  listed: 0,
  failed: 0,
  skipped: 0,
  policy: 0,
  company: 0,
  items: [] as Array<{ title: string; url: string; day: string | null; companies: string[]; kind?: string; articleId?: string; skipped?: string }>,
};
const tagEntries: Array<{ id: string; url: string; title: string; companies: string[]; topic?: string; source?: string }> = [];

for (const { row: r, policy } of byUrl.values()) {
  const url = (r["原文链接"] || "").trim();
  const title = (r["标题"] || "").trim();
  const media = (r["媒体"] || "").trim();
  const day = (r["落款日期"] || "").trim() || null;
  const facts = (r["事实摘要"] || "").trim();
  const verify = (r["核验状态"] || "").trim();
  const companies = companiesOf(r);
  const src = sourceFor(media);
  const kind = policy && companies.length ? "policy+company" : policy ? "policy" : "company";
  if (!url || !title || !src) {
    summary.failed += 1;
    summary.items.push({ title, url, day, companies: companies.map((c) => c.name), kind, skipped: !src ? "unknown media" : "missing url/title" });
    continue;
  }
  if (!policy && !companies.length) {
    summary.skipped += 1;
    summary.items.push({ title, url, day, companies: [], kind, skipped: "no company mapping and not policy" });
    continue;
  }
  try {
    await ensureSource(src.id, src.name, src.existing);
    const publishedAt = day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? new Date(`${day}T00:00:00+08:00`) : null;
    const tags = [
      ...companies.flatMap((c) => [c.name, `entity:${c.id}`]),
      ...(policy ? ["政策/监管"] : []),
    ];
    const res = await upsertMaterial({
      sourceId: src.id,
      url,
      title,
      language: "zh",
      publishedAt,
      publicationTime: day,
      excerpt: facts ? facts.slice(0, 280) : null,
      bodyText: facts || null,
      bodyStatus: /已核对原文/.test(verify) ? "ok" : /未查到原文/.test(verify) ? "unconfirmed" : (facts.length >= 80 ? "ok" : "unconfirmed"),
      via: "import",
      backfill: policy ? "policy-backfill" : "company-backfill",
      raw: {
        brief: policy ? "policy-backfill" : "company-backfill",
        section: policy ? "policy" : "company",
        media,
        verify,
        信源类型: r["信源类型"] || "",
        分类: r["分类"] || "",
        consultationDraft: /征求意见稿|公开征求意见/.test(`${title} ${facts}`),
        company: companies.map((c) => c.name).join("、"),
        country: r["国家"] || "",
        age: r["学生年龄段"] || "",
        // 故意不写入 CSV 里的内部备注列。
      },
    });
    if (res.created) summary.created += 1;
    if (res.revised) summary.revised += 1;
    if (policy) summary.policy += 1;
    if (companies.length) summary.company += 1;
    await ensurePublicListing(res.articleId, title, facts, url, tags, publishedAt, policy ? "政策/监管" : "行业动态");
    summary.listed += 1;
    tagEntries.push({
      id: res.articleId,
      url,
      title,
      companies: companies.map((c) => c.name),
      topic: policy ? "政策与合规" : undefined,
      source: policy ? "policy-backfill" : "company-backfill",
    });
    summary.items.push({ title, url, day, companies: companies.map((c) => c.name), kind, articleId: res.articleId });
  } catch (err) {
    summary.failed += 1;
    summary.items.push({ title, url, day, companies: companies.map((c) => c.name), kind, skipped: (err as Error).message });
    console.error("FAIL", url, (err as Error).message);
  }
}

if (tagEntries.length) mergeContentTags(tagEntries);
console.log(JSON.stringify({ ...summary, companies: [...new Set(summary.items.flatMap((i) => i.companies))] }, null, 2));
await stopBoss();
await closeDb();
