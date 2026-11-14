// Re-queue editorial analysis for every scored article of one source, after a prompt change.
// Usage (inside the api container):
//   node /app/scripts/rescore-source.ts 芥末堆
import { closeDb, sql } from "@aihot/backend/db";
import { queueProcessing } from "@aihot/backend/jobs/content";
import { stopBoss } from "@aihot/backend/jobs/queue";

const name = process.argv[2];
if (!name) {
  console.error("usage: node /app/scripts/rescore-source.ts <source-name>");
  process.exit(1);
}

const tag = `rescore-prompt:${new Date().toISOString().slice(0, 16)}`;
const rows = await sql<{ id: string; title: string }[]>`
  UPDATE articles a
  SET processing_state = 'new',
      processing_error = NULL,
      processing_attempts = 0,
      processing_retry_at = NULL,
      processing_queued_at = NULL
  WHERE a.id IN (
    SELECT a2.id
    FROM articles a2
    JOIN sources s ON s.id = a2.source_id
    JOIN analyses an ON an.article_id = a2.id
    WHERE s.name = ${name}
  )
  RETURNING a.id, a.title
`;

let enqueued = 0;
for (const r of rows) {
  if (await queueProcessing(r.id, { step: "analyze", attemptTag: tag })) enqueued += 1;
}
console.log(JSON.stringify({ source: name, reset: rows.length, enqueued, attemptTag: tag, ids: rows.map((r) => r.id) }));

await stopBoss();
await closeDb();
