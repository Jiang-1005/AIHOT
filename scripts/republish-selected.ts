// Re-apply publication rules (including the featured freshness window) to current
// selection candidates. No model calls.
//   docker exec -w /app xintian-edu-hot-api-1 node /app/scripts/republish-selected.ts
import { closeDb, sql } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { publishArticle } from "@aihot/backend/publication/publish";
import { featuredDatelineDay, featuredSlot, SELECTION } from "@aihot/industry/selection";

const rows = await sql<{
  article_id: string; url: string; publication_time: string | null; published_at: Date | null;
  title: string; selected: boolean; selection_candidate: boolean;
}[]>`
  SELECT p.article_id, a.url, a.publication_time, a.published_at, p.title, p.selected, p.selection_candidate
  FROM publications p
  JOIN articles a ON a.id = p.article_id
  LEFT JOIN LATERAL (SELECT score FROM analyses WHERE article_id = a.id ORDER BY id DESC LIMIT 1) an ON true
  WHERE p.selection_candidate OR p.selected OR an.score >= ${SELECTION.threshold}
`;

const summary = [];
for (const r of rows) {
  const dateline = featuredDatelineDay({ url: r.url, publicationTime: r.publication_time, publishedAt: r.published_at });
  await publishArticle(r.article_id);
  const [after] = await sql<{ selected: boolean }[]>`SELECT selected FROM publications WHERE article_id = ${r.article_id}`;
  const selectedAfter = after?.selected ?? null;
  summary.push({
    title: r.title,
    dateline,
    slot: selectedAfter ? featuredSlot(dateline) : "无",
    selectedBefore: r.selected,
    selectedAfter,
  });
}
console.log(JSON.stringify({ threshold: SELECTION.threshold, featuredMaxAgeDays: SELECTION.featuredMaxAgeDays, archiveMaxAgeDays: SELECTION.archiveMaxAgeDays, items: summary }, null, 2));

await stopBoss();
await closeDb();
