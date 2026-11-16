// Re-queue editorial analysis for every article that already has a score, after a scoring-prompt change.
//   docker exec -w /app xintian-edu-hot-api-1 node /app/scripts/rescore-scored.ts
import { closeDb, sql } from "@aihot/backend/db";
import { queueProcessing } from "@aihot/backend/jobs/content";
import { stopBoss } from "@aihot/backend/jobs/queue";

const tag = `rescore-relevance:${new Date().toISOString().slice(0, 16)}`;
const rows = await sql<{ id: string }[]>`
  UPDATE articles a
  SET processing_state = 'new',
      processing_error = NULL,
      processing_attempts = 0,
      processing_retry_at = NULL,
      processing_queued_at = NULL
  WHERE a.id IN (
    SELECT a2.id
    FROM articles a2
    JOIN analyses an ON an.article_id = a2.id
    WHERE an.score IS NOT NULL
  )
  RETURNING a.id
`;

const unique = [...new Set(rows.map((r) => r.id))];
let enqueued = 0;
for (const id of unique) {
  if (await queueProcessing(id, { step: "analyze", attemptTag: tag })) enqueued += 1;
}
console.log(JSON.stringify({ reset: unique.length, enqueued, attemptTag: tag }));

await stopBoss();
await closeDb();
