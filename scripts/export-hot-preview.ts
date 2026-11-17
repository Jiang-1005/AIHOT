// Preview export: re-rank the hot board on a local copy database and write the api's /api/site/hot answer
// to site/preview/hot.json, which a Vercel preview's api serves instead of reading its configured database.
//
//   DATABASE_URL=postgres://…/hot_preview_<date> node scripts/export-hot-preview.ts
//
// Refuses Neon and the live local database ("aihot"): the target must be a copy named hot_preview_*.
// Uses this checkout's ranking code (HOT_RANKING_MODE as set; default heat), so the file is a real
// recompute, never hand-written. site/preview/ is not committed.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const url = process.env.DATABASE_URL ?? "";
const dbName = (() => { try { return new URL(url).pathname.replace(/^\//, ""); } catch { return ""; } })();
if (!/^hot_preview_[a-z0-9_]+$/.test(dbName) || /neon\.tech|-pooler\./i.test(url)) {
  console.error(JSON.stringify({ ok: false, error: "DATABASE_URL must be a local copy database named hot_preview_*" }));
  process.exit(2);
}

const { installModules } = await import("@aihot/backend/modules");
const { SERVER_MODULES } = await import("@aihot/site/modules/server");
installModules(SERVER_MODULES);
const { closeDb, sql } = await import("@aihot/backend/db");
const { computeHotRanking, hotRankingMode, hotRuleVersion } = await import("@aihot/backend/events/hot");
const { loadHot } = await import("@aihot/backend/publication/stories");
const { REPO_ROOT } = await import("@aihot/backend/config");

try {
  const { id, entries } = await computeHotRanking();
  const [row] = await sql<{ computed_at: Date; rule_version: string; candidates: number | null }[]>`
    SELECT computed_at, rule_version, (evidence->>'candidates')::int AS candidates FROM hot_rankings WHERE id = ${id}`;
  const hot = await loadHot();
  if (hot.computedAt !== row!.computed_at.toISOString()) throw new Error(`loadHot returned ranking ${hot.computedAt}, expected ${row!.computed_at.toISOString()}`);
  const dir = path.join(REPO_ROOT, "site/preview");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "hot.json"), JSON.stringify(hot));
  const meta = { database: dbName, rankingId: id, ruleVersion: row!.rule_version, mode: hotRankingMode(), expectedRule: hotRuleVersion(), candidates: row!.candidates, entries, computedAt: hot.computedAt, exportedAt: new Date().toISOString() };
  writeFileSync(path.join(dir, "hot.meta.json"), JSON.stringify(meta, null, 2));
  console.log(JSON.stringify({ ok: true, ...meta, stories: hot.entries.map((e) => [e.rank, e.story.publicId, e.heat, e.sourceCount, e.story.title]) }));
} finally {
  await closeDb();
}
