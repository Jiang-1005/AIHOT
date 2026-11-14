// One-off 30-day backfill for 中国教育在线 + 多知.
// Usage: docker exec -w /app xintian-edu-hot-api-1 node /app/scripts/ingest-cn-sources.ts [/data/cn-ingest.json]
import { readFileSync } from "node:fs";
import { installModules } from "@aihot/backend/modules";
import { closeDb } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { queueProcessing } from "@aihot/backend/jobs/content";
import { SERVER_MODULES } from "@aihot/site/modules/server";

installModules(SERVER_MODULES);

const path = process.argv[2] ?? "/data/cn-ingest.json";
const payload = JSON.parse(readFileSync(path, "utf8")) as {
  eol: Item[];
  duozhi: Item[];
};

interface Item {
  sourceId: string;
  url: string;
  title: string;
  day: string;
  bodyText?: string;
  bodyChars?: number;
  http?: number;
}

const rows: Item[] = [...(payload.eol ?? []), ...(payload.duozhi ?? [])];
const BACKFILL = "cn-sources-2026-10-11";
let created = 0, revised = 0, queued = 0, skipped = 0, failed = 0;

for (const it of rows) {
  if (!it.url || !it.title || !/^\d{4}-\d{2}-\d{2}$/.test(it.day)) {
    skipped += 1;
    continue;
  }
  const body = (it.bodyText ?? "").trim();
  const publishedAt = new Date(`${it.day}T00:00:00+08:00`);
  // Recent news (within 48h of now) is not an archive backfill, even on first import.
  const ageMs = Date.now() - publishedAt.getTime();
  const explicitBackfill = Number.isFinite(ageMs) && ageMs > 48 * 3600 * 1000 ? BACKFILL : null;
  try {
    const res = await upsertMaterial({
      sourceId: it.sourceId,
      url: it.url,
      title: it.title,
      language: "zh",
      publishedAt,
      publicationTime: it.day,
      excerpt: body ? body.slice(0, 280) : null,
      bodyText: body || null,
      bodyStatus: body.length >= 80 ? "ok" : body ? "unconfirmed" : "pending",
      via: "import",
      backfill: explicitBackfill,
    });
    if (res.created) created += 1;
    if (res.revised) revised += 1;
    if (res.created || res.revised || res.processingNeeded) {
      if (await queueProcessing(res.articleId)) queued += 1;
    }
  } catch (err) {
    failed += 1;
    console.error("FAIL", it.url, (err as Error).message);
  }
}

console.log(JSON.stringify({ total: rows.length, created, revised, queued, skipped, failed, path }));
await stopBoss();
await closeDb();
