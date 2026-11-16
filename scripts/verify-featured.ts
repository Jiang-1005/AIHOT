// Second-pass verification for 精选 candidates, then UTF-8-BOM CSV export.
//
// Four acceptance checks (only items that pass all four stay in / enter 精选):
//   1. original_url_ok     原媒体链接（不是知新聚合页）最终 HTTP 200
//   2. summary_faithful    中文摘要与原文相符，未编造数字/名称；核不到的主张标「未查到原文」
//   3. score_has_reason    有分数，且有一句写明的评分理由
//   4. relevance_noted     写明与心田花开（情商语文 / 表达练习）的关系；允许「无直接关系，仅同属 AI+教育」
//
// Usage (inside the api container, after scoring has run):
//   docker cp scripts/verify-featured.ts xintian-edu-hot-api-1:/app/scripts/verify-featured.ts
//   docker cp /workspace/research/zhixin/selected_all.csv xintian-edu-hot-api-1:/data/zhixin-selected_all.csv
//   docker exec -w /app -e ZHIXIN_CSV=/data/zhixin-selected_all.csv \
//     -e FEATURED_CSV=/data/featured-batch1.csv \
//     xintian-edu-hot-api-1 node /app/scripts/verify-featured.ts --apply
//   docker cp xintian-edu-hot-api-1:/data/featured-batch1.csv /workspace/edu-hot/featured-batch1.csv
//
// Schedule: run after the worker finishes a collect/analyze cycle (or cron 15 minutes after 8:45).
// Idempotent: re-running overwrites the CSV and updates editorial_overrides to the latest verdict.

import { closeDb, sql } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { publishArticle } from "@aihot/backend/publication/publish";
import { featuredDatelineDay, featuredSlot, SELECTION } from "@aihot/industry/selection";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { parse } from "node:path";

const APPLY = process.argv.includes("--apply");
const ZHIXIN_CSV = process.env.ZHIXIN_CSV || "/data/zhixin-selected_all.csv";
const FEATURED_CSV = process.env.FEATURED_CSV || "/data/featured-batch1.csv";
const JSON_OUT = process.env.FEATURED_JSON || "/data/featured-batch1.json";
const DEEPSEEK_URL = (process.env.DEEPSEEK_BASE_URL || process.env.LLM_BASE_URL || "https://api.deepseek.com/v1").replace(/\/$/, "");
const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY || process.env.LLM_API_KEY || "";
const DEEPSEEK_MODEL = process.env.VERIFY_MODEL || "deepseek-chat";

const BEIJING = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function beijingTime(d: Date | string | null | undefined): string {
  if (!d) return "未标明";
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return "未标明";
  return `${BEIJING.format(date).replace("T", " ").replace(" ", " ")}（北京时间）`;
}

function loadZhixinOriginals(path: string): Map<string, { original: string; source: string }> {
  const map = new Map<string, { original: string; source: string }>();
  if (!existsSync(path)) return map;
  const text = readFileSync(path, "utf8");
  const lines = text.split(/\r?\n/);
  if (lines.length < 2) return map;
  const header = splitCsv(lines[0]!);
  const iOriginal = header.indexOf("original");
  const iZhixin = header.indexOf("zhixin");
  const iSource = header.indexOf("source");
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const cols = splitCsv(line);
    const zhixin = cols[iZhixin] || "";
    const original = cols[iOriginal] || "";
    if (!zhixin || !original) continue;
    const rec = { original, source: cols[iSource] || "" };
    map.set(zhixin.trim(), rec);
    const guid = zhixin.trim().split("/").filter(Boolean).pop();
    if (guid) map.set(guid, rec);
  }
  return map;
}

function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') inQ = false;
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") out.push(cur), (cur = "");
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

const INFERRED_PROCESS = /合理概括|与原文一致|无额外推断|没有(?:额外)?推断|未超出原文|属于概括|摘要压缩|并未推断|无推断内容/;

/** inferred = only summary claims that go beyond the article; drop process notes and empty filler. */
function sanitizeInferred(values: unknown): string {
  const parts = Array.isArray(values) ? values : (values ? [values] : []);
  const kept = parts
    .map((v) => String(v ?? "").trim())
    .filter((s) => s && !INFERRED_PROCESS.test(s) && !/^(无|没有|无此|同上|略)$/.test(s));
  return kept.join("；");
}

function isZhixinUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return h === "zhixin.qianxuyan.com" || h.endsWith(".qianxuyan.com");
  } catch {
    return /zhixin\.qianxuyan\.com/.test(url);
  }
}

function htmlToText(html: string): string {
  let s = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  s = s.replace(/<\/(p|div|h1|h2|h3|h4|li|tr|br|section|article)>/gi, "\n");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, '"');
  s = s.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return s.slice(0, 24_000);
}

async function fetchOriginal(url: string): Promise<{ status: number; finalUrl: string; text: string; error?: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25_000);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: ctrl.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
      },
    });
    const buf = Buffer.from(await res.arrayBuffer());
    const text = htmlToText(buf.toString("utf8"));
    return { status: res.status, finalUrl: res.url || url, text };
  } catch (error) {
    return { status: 0, finalUrl: url, text: "", error: String(error instanceof Error ? error.message : error).slice(0, 300) };
  } finally {
    clearTimeout(t);
  }
}

async function chatJson(prompt: string): Promise<Record<string, unknown>> {
  if (!DEEPSEEK_KEY) throw new Error("DEEPSEEK_API_KEY / LLM_API_KEY is not set");
  const res = await fetch(`${DEEPSEEK_URL}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${DEEPSEEK_KEY}` },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      temperature: 0.1,
      max_tokens: 2000,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "你是核稿编辑。只根据给定原文核查摘要，不编造。必须输出 JSON。" },
        { role: "user", content: prompt },
      ],
    }),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`DeepSeek HTTP ${res.status}: ${raw.slice(0, 400)}`);
  const data = JSON.parse(raw) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content ?? "";
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error("No JSON object in model output");
  return JSON.parse(content.slice(start, end + 1)) as Record<string, unknown>;
}

type Candidate = {
  article_id: string;
  source: string;
  source_id: string;
  title: string;
  title_zh: string | null;
  url: string;
  published_at: Date | null;
  publication_time: string | null;
  summary_zh: string | null;
  reason_zh: string | null;
  score: string | number | null;
  base_score: string | number | null;
  relevance_bonus: string | number | null;
  xintian_relevance: string | null;
  xintian_relevance_reason: string | null;
  fact_id: number | null;
  body_text: string | null;
  analysis_selected: boolean;
  pub_selected: boolean | null;
  selection_candidate: boolean | null;
  grouping_status: string | null;
  prompt_version: string | null;
  analysis_created_at: Date | null;
};

function joinList(v: unknown): string {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean).join("；");
  if (v == null) return "";
  return String(v).trim();
}

const CHECKS = ["original_url_ok", "summary_faithful", "score_has_reason", "relevance_noted"] as const;
const CHECK_LABEL: Record<(typeof CHECKS)[number], string> = {
  original_url_ok: "原文链接可打开（非知新，HTTP 200）",
  summary_faithful: "摘要忠于原文",
  score_has_reason: "评分有书面理由",
  relevance_noted: "写明与心田（情商语文/表达练习）的关系",
};

const candidates = await sql<Candidate[]>`
  SELECT a.id AS article_id, s.name AS source, s.id AS source_id,
         coalesce(an.title_zh, a.title) AS title, an.title_zh, a.url, a.published_at,
         a.publication_time, an.summary_zh, an.reason_zh, an.score, a.body_text,
         an.output->>'baseScore' AS base_score,
         an.output->>'relevanceBonus' AS relevance_bonus,
         an.output->>'xintianRelevance' AS xintian_relevance,
         an.output->>'xintianRelevanceReason' AS xintian_relevance_reason,
         p.fact_id, a.grouping_status,
         an.selected AS analysis_selected, p.selected AS pub_selected,
         p.selection_candidate, an.prompt_version, an.created_at AS analysis_created_at
  FROM analyses an
  JOIN articles a ON a.id = an.article_id
  JOIN sources s ON s.id = a.source_id
  LEFT JOIN publications p ON p.article_id = a.id
  WHERE an.id IN (SELECT max(id) FROM analyses GROUP BY article_id)
    AND an.score >= ${SELECTION.threshold}
  ORDER BY an.score DESC NULLS LAST, a.published_at DESC NULLS LAST
`;

const zhixinMap = loadZhixinOriginals(ZHIXIN_CSV);
const rows: Record<string, unknown>[] = [];
const toUnselect: { article_id: string; reason: string }[] = [];
const toKeep: string[] = [];

for (const c of candidates) {
  let originalUrl = c.url;
  let urlNote = "";
  if (isZhixinUrl(c.url)) {
    const guid = c.url.split("/").filter(Boolean).pop() || "";
    const hit = zhixinMap.get(c.url) || zhixinMap.get(guid);
    if (hit?.original && !isZhixinUrl(hit.original)) {
      originalUrl = hit.original;
      urlNote = `知新条目已改用 links.original（信源标注：${hit.source || "未标明"}）`;
    } else {
      urlNote = "知新条目未找到 links.original，不能用聚合页充当原文链接";
    }
  }

  const fetched = isZhixinUrl(originalUrl)
    ? { status: 0, finalUrl: originalUrl, text: "", error: "仍是知新聚合链接" }
    : await fetchOriginal(originalUrl);

  let originalText = fetched.text;
  let urlOk = !isZhixinUrl(originalUrl) && fetched.status === 200 && fetched.text.trim().length > 80;
  if (!urlOk && !isZhixinUrl(originalUrl) && (c.body_text ?? "").trim().length > 80 && (fetched.status === 403 || fetched.status === 0)) {
    originalText = c.body_text ?? "";
    urlOk = true;
    urlNote = (urlNote ? urlNote + "；" : "") + `原文页 GET 返回 ${fetched.status || "失败"}，改用站内已抓取的原文正文核验`;
  }
  const check1 = urlOk;
  const originalTextFinal = originalText || (c.body_text ?? "");

  const verifyPrompt = `请核对下面这篇已经打过分、写了中文摘要的教育新闻。只依据【原文】判断，原文里没有的数字和名称不要当成事实。

【四项检查，必须逐项判断 true/false】
1. original_url_ok：下面会由程序先判断链接是否原媒体且 HTTP 200，你不要改这个程序结论，但要看摘要是否在讲这篇原文。
2. summary_faithful：摘要里的事实、数字、人名、机构名必须能在原文里找到；允许合理压缩，不允许编造。若摘要把原文没有的数字/名称写成既定事实，本项为 false。
3. score_has_reason：已有分数，且能写出一句基于原文的评分理由（可改写已有理由，但不能空、不能套话）。
4. relevance_noted：必须写一句与心田花开产品锚点的关系：情商语文/表达练习智能体（孩子讲故事或表达→AI反馈→老师点评→家长成长报告）、未成年人产品设计/监护人开启（默认关闭）、AI只追问不代写。不要默认写成「无直接关系」。若原文事实可直接对照这些决策（例如：按孩子兴趣定制提示卡的实验；K-12/学生账号默认关闭、须管理员或监护人开启），写明「直接相关：…」。若方法可迁移但原文不是直接讲这些点（例如把对话本身当成考核、强调过程而不是代写成品），写明「可迁移：…」。仅同属 AI+教育、对不上产品锚点时，才写「无直接关系，仅同属 AI+教育」并说明为何对不上。若这篇根本不是 AI+教育/教培，本项为 false。

【已有材料】
标题：${c.title}
信源：${c.source}
原链接：${originalUrl}
程序测定的链接状态：HTTP ${fetched.status}${fetched.error ? `，错误：${fetched.error}` : ""}
分数：${c.score ?? "无"}（base ${c.base_score ?? "未标明"} + 相关性加分 ${c.relevance_bonus ?? "未标明"}，档位 ${c.xintian_relevance || "未标明"}）
已有相关性说明：${c.xintian_relevance_reason || "（无）"}
已有推荐理由：${c.reason_zh || "（无）"}
中文摘要：${c.summary_zh || "（无）"}

【原文】
${originalTextFinal.slice(0, 16_000) || "（未能取到原文，请勿编造；核不到的写「未查到原文」）"}

【输出 JSON，字段必须齐全】
{
  "facts": ["原文中确有、且摘要用到的事实或数字"],
  "inferred": ["仅列出摘要里超出原文的主张。不要写核验过程说明，例如「属于合理概括」「与原文一致」「无额外推断」「摘要压缩了列举」。若摘要没有超出原文的主张，必须输出空数组 []"],
  "unverified": ["摘要里出现但原文找不到的数字或主张，写「未查到原文：…」"],
  "score_reason": "一句评分理由，简体中文",
  "relevance_xintian": "一句与情商语文/表达练习的关系，简体中文",
  "summary_faithful": true,
  "score_has_reason": true,
  "relevance_noted": true,
  "notes": "如有需提醒的歧义，写在这里，没有则空字符串"
}`;

  let model: Record<string, unknown> = {};
  let modelError = "";
  try {
    model = await chatJson(verifyPrompt);
  } catch (error) {
    modelError = String(error instanceof Error ? error.message : error).slice(0, 400);
  }

  const checks: Record<string, boolean> = {
    original_url_ok: check1,
    summary_faithful: model.summary_faithful === true && !modelError,
    score_has_reason: model.score_has_reason === true && !!(model.score_reason || c.reason_zh) && c.score != null && !modelError,
    relevance_noted: model.relevance_noted === true && String(model.relevance_xintian ?? "").trim().length > 0 && !modelError,
  };
  // If the model could not run, fail the model-dependent checks rather than invent a pass.
  if (modelError) {
    checks.summary_faithful = false;
    checks.score_has_reason = false;
    checks.relevance_noted = false;
  }
  const failed = CHECKS.filter((k) => !checks[k]).map((k) => CHECK_LABEL[k]);
  const pass = failed.length === 0;
  const passes = pass ? "yes" : `no：${failed.join("；")}`;

  const unverified = joinList(model.unverified) || (check1 ? "" : "未查到原文：原媒体链接未能以 HTTP 200 打开");
  const dateline = featuredDatelineDay({ url: c.url, publicationTime: c.publication_time, publishedAt: c.published_at });
  const slot = pass && c.grouping_status === "complete" ? featuredSlot(dateline) : "无";
  const row = {
    article_id: c.article_id,
    title: c.title,
    original_url: originalUrl,
    source: c.source,
    published_at: beijingTime(c.published_at),
    dateline: dateline ?? "",
    slot,
    summary_zh: c.summary_zh || "",
    facts: joinList(model.facts),
    inferred: sanitizeInferred(model.inferred),
    unverified,
    score: c.score == null ? "" : String(c.score).replace(/\.00$/, ""),
    base_score: c.base_score == null || c.base_score === "" ? "" : String(c.base_score).replace(/\.00$/, ""),
    relevance_bonus: c.relevance_bonus == null || c.relevance_bonus === "" ? "0" : String(c.relevance_bonus).replace(/\.00$/, ""),
    score_reason: String(model.score_reason || c.reason_zh || "").trim(),
    relevance_xintian: String(model.relevance_xintian || c.xintian_relevance_reason || "").trim(),
    fact_id: c.fact_id,
    related_urls: "",
    score_run: scoreRunLabel(c.prompt_version, c.analysis_created_at),
    passes_4_checks: passes,
    pub_selected_before: c.pub_selected,
    selection_candidate: c.selection_candidate,
    url_note: urlNote,
    http_status: fetched.status,
    model_error: modelError,
    notes: String(model.notes || ""),
  };
  rows.push(row);
  if (pass) toKeep.push(c.article_id);
  else toUnselect.push({ article_id: c.article_id, reason: `四项检查未通过：${failed.join("；")}` });
  console.log(JSON.stringify({ title: c.title, pass, failed, status: fetched.status, originalUrl }));
}



const THE74_URL = "https://www.the74million.org/article/googles-new-ai-ultimatum-sparks-concern-over-tech-giants-power-in-ca-schools/";
const THE74_TITLE = "反面案例：不给关闭选项会引发家长和学区反对";
const THE74_RELEVANCE = "反面案例：不给关闭选项会引发家长和学区反对。学区没有不带 AI 的搜索选项，不启用 AI 版搜索就失去 Google 搜索，属于强制捆绑，与「默认关闭、由人开启」相反，不能作为心田设计的支持证据，不加相关性加分。Markey 议员 2026 年 11 月 9 日致 Google 信：未查到原文。";

function attachThe74Standalone(rows: Record<string, unknown>[]) {
  return rows.map((r) => {
    const related = String(r.related_urls ?? "").split(" | ").map((s) => s.trim()).filter((s) => s && s !== THE74_URL);
    const isThe74 = r.original_url === THE74_URL;
    if (isThe74) {
      return {
        ...r,
        title: THE74_TITLE,
        relevance_bonus: "0",
        base_score: "62",
        score: "62",
        relevance_xintian: THE74_RELEVANCE,
        related_urls: related.join(" | "),
        counter_facts: "",
      };
    }
    // The 74 is its own card; do not keep it on the Google item's related or counter-facts.
    return { ...r, related_urls: related.join(" | "), counter_facts: "" };
  });
}


function scoreRunLabel(promptVersion: string | null | undefined, createdAt: Date | string | null | undefined): string {
  const pv = String(promptVersion ?? "");
  const m = pv.match(/selection-score@[A-Za-z0-9]+/);
  const prompt = m ? m[0] : (pv ? pv.split("+")[0] : "未标明");
  const when = createdAt ? beijingTime(createdAt) : "时间未标明";
  return `${prompt} · ${when}`;
}

function collapseSameFact(rows: Record<string, unknown>[]) {
  const byFact = new Map<string, Record<string, unknown>[]>();
  for (const r of rows) {
    if (r.fact_id == null || r.fact_id === "") continue;
    const k = String(r.fact_id);
    const list = byFact.get(k) ?? [];
    list.push(r);
    byFact.set(k, list);
  }
  const drop = new Set<string>();
  for (const group of byFact.values()) {
    if (group.length < 2) continue;
    const keepers = group.filter((r) => r.slot === "精选" || r.slot === "往期");
    const all = (keepers.length ? keepers : group).slice().sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
    const lead = all[0]!;
    const others = group.filter((r) => r.article_id !== lead.article_id);
    lead.related_urls = others.map((r) => r.original_url).filter(Boolean).join(" | ");
    for (const r of others) drop.add(String(r.article_id));
  }
  return rows.filter((r) => !drop.has(String(r.article_id))).map((r) => ({ ...r, related_urls: r.related_urls ?? "" }));
}

const exported = attachThe74Standalone(collapseSameFact(rows));

if (APPLY) {
  for (const item of toUnselect) {
    await sql`
      INSERT INTO editorial_overrides (article_id, fields, reason, version, updated_by)
      VALUES (${item.article_id}, ${sql.json({ selected: false })}, ${item.reason}, 1, ${"verify-featured"})
      ON CONFLICT (article_id) DO UPDATE SET
        fields = editorial_overrides.fields || ${sql.json({ selected: false })},
        reason = EXCLUDED.reason,
        version = editorial_overrides.version + 1,
        updated_by = EXCLUDED.updated_by,
        updated_at = now()`;
    await publishArticle(item.article_id);
  }
}

const header = [
  "title",
  "original_url",
  "source",
  "published_at",
  "dateline",
  "slot",
  "summary_zh",
  "facts",
  "inferred",
  "unverified",
  "base_score",
  "relevance_bonus",
  "score",
  "score_reason",
  "relevance_xintian",
  "related_urls",
  "counter_facts",
  "score_run",
  "passes_4_checks",
];
const csv =
  "\ufeff" +
  header.join(",") +
  "\n" +
  exported
    .map((r) => header.map((h) => csvCell(r[h])).join(","))
    .join("\n") +
  "\n";
writeFileSync(FEATURED_CSV, csv);
const slotCounts = { 精选: 0, 往期: 0, 无: 0 };
for (const r of exported) {
  const s = r.slot === "精选" || r.slot === "往期" ? r.slot : "无";
  slotCounts[s] += 1;
}
writeFileSync(JSON_OUT, JSON.stringify({ generatedAt: beijingTime(new Date()), apply: APPLY, threshold: SELECTION.threshold, featuredMaxAgeDays: SELECTION.featuredMaxAgeDays, archiveMaxAgeDays: SELECTION.archiveMaxAgeDays, kept: toKeep.length, unselected: toUnselect.length, slotCounts, rows: exported }, null, 2));
console.log(JSON.stringify({ candidates: candidates.length, exported: exported.length, kept: toKeep.length, unselected: toUnselect.length, slotCounts, csv: FEATURED_CSV, json: JSON_OUT, apply: APPLY }));

void parse;
await stopBoss();
await closeDb();
