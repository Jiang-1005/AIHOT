// Re-apply the single featured threshold (SELECTION.threshold) to existing scores
// and republish. No model calls.
//   docker exec -w /app xintian-edu-hot-api-1 node /app/scripts/apply-threshold.ts
import { closeDb, sql } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { publishArticle } from "@aihot/backend/publication/publish";
import { featuredDatelineDay, featuredSlot, SELECTION } from "@aihot/industry/selection";

const latest = await sql<{
  analysis_id: number; article_id: string; score: string | number | null; selected: boolean;
  output: Record<string, unknown> | null; title: string; url: string;
  publication_time: string | null; published_at: Date | null;
  pub_selected: boolean | null; selection_candidate: boolean | null;
}[]>`
  SELECT an.id AS analysis_id, a.id AS article_id, an.score, an.selected, an.output,
         coalesce(an.title_zh, a.title) AS title, a.url, a.publication_time, a.published_at,
         p.selected AS pub_selected, p.selection_candidate
  FROM analyses an
  JOIN articles a ON a.id = an.article_id
  LEFT JOIN publications p ON p.article_id = a.id
  WHERE an.id IN (SELECT max(id) FROM analyses GROUP BY article_id)
    AND (an.score IS NOT NULL OR p.selected OR p.selection_candidate OR an.selected)
`;

const threshold = SELECTION.threshold;
const changed = [];
const ids = new Set<string>();
for (const r of latest) {
  const score = r.score == null ? null : Number(r.score);
  const shouldSelect = score != null && score >= threshold;
  const output = { ...(r.output ?? {}), threshold, selected: shouldSelect };
  if (r.selected !== shouldSelect) {
    await sql`UPDATE analyses SET selected = ${shouldSelect}, output = ${sql.json(output)} WHERE id = ${r.analysis_id}`;
    changed.push({ title: r.title, score, selectedBefore: r.selected, selectedAfter: shouldSelect });
  } else if (r.output && (r.output as { threshold?: unknown }).threshold !== threshold) {
    await sql`UPDATE analyses SET output = ${sql.json(output)} WHERE id = ${r.analysis_id}`;
  }
  if (shouldSelect || r.selected || r.pub_selected || r.selection_candidate) ids.add(r.article_id);
}

const published = [];
for (const id of ids) {
  await publishArticle(id);
  const [row] = await sql<{
    title: string; selected: boolean; selection_candidate: boolean; url: string;
    publication_time: string | null; published_at: Date | null; score: string | number | null;
  }[]>`
    SELECT p.title, p.selected, p.selection_candidate, a.url, a.publication_time, a.published_at, p.score
    FROM publications p JOIN articles a ON a.id = p.article_id WHERE p.article_id = ${id}`;
  if (!row) continue;
  const dateline = featuredDatelineDay({ url: row.url, publicationTime: row.publication_time, publishedAt: row.published_at });
  published.push({
    title: row.title,
    score: row.score,
    dateline,
    slot: row.selected ? featuredSlot(dateline) : "无",
    selected: row.selected,
    selection_candidate: row.selection_candidate,
  });
}

const slotCounts = { 精选: 0, 往期: 0, 无: 0 };
for (const r of published) slotCounts[r.slot === "精选" || r.slot === "往期" ? r.slot : "无"] += 1;
console.log(JSON.stringify({ threshold, featuredMaxAgeDays: SELECTION.featuredMaxAgeDays, archiveMaxAgeDays: SELECTION.archiveMaxAgeDays, analysisFlips: changed, published: published.length, slotCounts, items: published }, null, 2));

await stopBoss();
await closeDb();
