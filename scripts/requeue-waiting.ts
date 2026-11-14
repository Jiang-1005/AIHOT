// Clear retry timers on articles waiting after a provider outage (e.g. OpenRouter 429)
// and enqueue them for analysis. Run inside the api/worker container:
//   docker exec -w /app xintian-edu-hot-api-1 node /app/scripts/requeue-waiting.ts
import { closeDb, sql } from "@aihot/backend/db";
import { queueProcessing } from "@aihot/backend/jobs/content";
import { stopBoss } from "@aihot/backend/jobs/queue";

const rows = await sql<{ id: string }[]>`
  UPDATE articles
  SET processing_state = 'new',
      processing_attempts = 0,
      processing_retry_at = NULL,
      processing_error = NULL,
      processing_queued_at = NULL
  WHERE processing_state IN ('new', 'failed')
    AND (
      processing_error ILIKE '%Rate limit exceeded%'
      OR processing_error ILIKE '%free-models-per-day%'
      OR processing_error ILIKE '%Model default is not configured%'
      OR processing_retry_at IS NOT NULL
    )
  RETURNING id`;

let enqueued = 0;
for (const r of rows) {
  if (await queueProcessing(r.id)) enqueued += 1;
}
console.log(JSON.stringify({ reset: rows.length, enqueued }));

await stopBoss();
await closeDb();
