// Generic daily brief items import (company / policy / media materials).
// Accepts a date and one or more official items files. Idempotent: dedupes by 原文链接
// (within the batch and against existing articles). Does not change official collectors.
// An existing URL is not updated. A dateline that is a real calendar day, with an optional
// clock or parenthetical note, keeps that day as 原发日. 导入日 (--date) and 发现日 are not
// written into published_at. See scripts/brief-dateline.ts.
//
// Usage (prefer scripts/import-brief-items.sh, which copies this file into the
// api container first). Inside xintian-edu-hot-api-1, or from the repo root with DATABASE_URL:
//   node /app/scripts/import-brief-items.ts --date 2026-11-13
//   node /app/scripts/import-brief-items.ts --date 2026-11-13 --file /data/brief-20261113-items.csv
//   node /app/scripts/import-brief-items.ts --date 2026-11-13 /data/items.csv /data/items-pm.csv
//
// When --file / positional paths are omitted, auto-discovery only reads official names:
//   /data/brief-YYYYMMDD-items.csv
//   /data/items.csv, items-pm.csv, items-evening.csv
//   /workspace/ai-edu/briefs/daily-YYYY-MM-DD/{items.csv,items-pm.csv,items-evening.csv}
// Mid-day or working files such as items-noon.csv, items.dedup.csv, or 核验清单
// are not auto-imported. Pass them with --file only if you really intend to.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { beijingDate } from "@aihot/contracts/time";
import { installModules } from "@aihot/backend/modules";
import { closeDb } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { SERVER_MODULES } from "@aihot/site/modules/server";
import { importOneBriefItem, planBriefPublication } from "./brief-dateline.ts";

installModules(SERVER_MODULES);

function beijingToday(): string {
  return beijingDate(new Date());
}

function parseArgs(argv: string[]): { date: string; files: string[] } {
  let date: string | undefined;
  const files: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--date" || a === "-d") {
      date = argv[++i];
    } else if (a === "--file" || a === "-f") {
      const f = argv[++i];
      if (!f) throw new Error(`${a} requires a path`);
      files.push(f);
    } else if (a.startsWith("--date=")) {
      date = a.slice("--date=".length);
    } else if (a.startsWith("--file=")) {
      files.push(a.slice("--file=".length));
    } else if (a === "--help" || a === "-h") {
      console.log("Usage: import-brief-items.ts [--date YYYY-MM-DD] [--file items.csv] [items.csv ...]");
      process.exit(0);
    } else if (a.startsWith("-")) {
      throw new Error(`unknown flag ${a}`);
    } else {
      files.push(a);
    }
  }
  const chosen = date?.trim() || beijingToday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(chosen)) {
    throw new Error(`invalid date ${chosen}; expected YYYY-MM-DD`);
  }
  return { date: chosen, files };
}

// Keep in sync with OFFICIAL_ITEMS_NAMES in scripts/check-pipeline-health.py
const OFFICIAL_BRIEF_ITEM_FILES = new Set(["items.csv", "items-pm.csv", "items-evening.csv"]);

function discoverFiles(date: string): string[] {
  const compact = date.replaceAll("-", "");
  const found: string[] = [];
  const exact = `/data/brief-${compact}-items.csv`;
  if (existsSync(exact)) found.push(exact);
  const dirs = [`/data`, `/workspace/ai-edu/briefs/daily-${date}`];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!OFFICIAL_BRIEF_ITEM_FILES.has(name)) continue;
      found.push(path.join(dir, name));
    }
  }
  return uniqueExisting(found);
}

function uniqueExisting(files: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const file of files) {
    const resolved = path.resolve(file);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    if (!existsSync(resolved)) {
      throw new Error(`file not found: ${file}`);
    }
    out.push(resolved);
  }
  return out;
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

function normalizeUrl(url: string): string {
  return url.trim().replace(/#.*$/, "");
}

const { date: today, files: argFiles } = parseArgs(process.argv.slice(2));
const files = argFiles.length ? uniqueExisting(argFiles) : discoverFiles(today);
if (!files.length) {
  throw new Error(`no official items.csv / items-pm.csv / items-evening.csv (or /data/brief-${today.replaceAll("-", "")}-items.csv) found for ${today}; pass --file if you mean to import a specific path`);
}

type Incoming = { row: Record<string, string>; file: string; url: string; norm: string };
const byUrl = new Map<string, Incoming>();
let csvRows = 0;
const skippedBatchDup: string[] = [];
for (const file of files) {
  const rows = parseCsv(readFileSync(file, "utf8"));
  csvRows += rows.length;
  for (const row of rows) {
    const url = (row["原文链接"] || "").trim();
    const norm = normalizeUrl(url);
    const key = norm || url;
    if (!key) continue;
    if (byUrl.has(key)) {
      skippedBatchDup.push(url || key);
      continue;
    }
    byUrl.set(key, { row, file, url, norm });
  }
}

const summary = {
  date: today,
  files,
  csv: csvRows,
  unique: byUrl.size,
  skippedBatchDup,
  skippedExistingWrongTitle: [] as string[],
  created: 0,
  revised: 0,
  queued: 0,
  failed: 0,
  items: [] as Array<{ title: string; url: string; day: string | null; slot: string; articleId?: string; created?: boolean; skipped?: string }>,
};

for (const { row, url, norm } of byUrl.values()) {
  try {
    const item = await importOneBriefItem({ row, url, norm, briefDate: today });
    if (item.failed) summary.failed += 1;
    if (item.created) summary.created += 1;
    if (item.revised) summary.revised += 1;
    if (item.queued) summary.queued += 1;
    if (item.skipped === "duplicate url" || item.skipped?.startsWith("url already holds")) {
      summary.skippedExistingWrongTitle.push(url);
    }
    summary.items.push({
      title: item.title, url: item.url, day: item.day, slot: item.slot, articleId: item.articleId, created: item.created, skipped: item.skipped,
    });
  } catch (err) {
    summary.failed += 1;
    const rawDay = (row["落款日期"] || "").trim() || null;
    summary.items.push({ title: (row["标题"] || "").trim(), url, day: rawDay, slot: planBriefPublication(rawDay, today, new Date()).slot, skipped: (err as Error).message });
    console.error("FAIL", url, (err as Error).message);
  }
}

const featured = summary.items.filter((i) => i.slot === "featured" && !i.skipped).length;
const archive = summary.items.filter((i) => i.slot === "archive" && !i.skipped).length;
const undated = summary.items.filter((i) => i.slot === "undated").length;
console.log(JSON.stringify({ ...summary, dateSlots: { featured, archive, undated, skipped: summary.skippedExistingWrongTitle.length } }, null, 2));
await stopBoss();
await closeDb();
