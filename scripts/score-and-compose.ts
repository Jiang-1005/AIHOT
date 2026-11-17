// Worker-less daily run: score every article still waiting, group and digest them, then write
// every daily/weekly/monthly that is due (and refresh today's), and re-rank the hot board. Same code paths the worker uses;
// safe to run again. Run through scripts/score-and-compose.sh, not by hand.
import { closeDb, sql } from "@aihot/backend/db";
import { groupArticle } from "@aihot/backend/events/group";
import { composeStoryDigest } from "@aihot/backend/events/digest";
import { computeHotRanking } from "@aihot/backend/events/hot";
import { processArticle, settleNonEditorial } from "@aihot/backend/jobs/content";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { installModules } from "@aihot/backend/modules";
import { composeDueReports } from "@aihot/backend/reports/compose";
import { SERVER_MODULES } from "@aihot/site/modules/server";

installModules(SERVER_MODULES);
const tag = `score-and-compose:${new Date().toISOString().slice(0, 16)}`;
const counts: Record<string, number> = {};
const bump = (k: string) => { counts[k] = (counts[k] ?? 0) + 1; };
try {
  // 1. Score: articles the worker would have analysed. Retry timers are honoured.
  const waiting = await sql<{ id: string }[]>`
    SELECT id FROM articles
    WHERE processing_state = 'new' AND (processing_retry_at IS NULL OR processing_retry_at <= now())
    ORDER BY created_at`;
  for (const a of waiting) bump(`score:${(await processArticle(a.id, { attemptTag: tag })).state}`);

  // 2. Group into events, in the worker's serial order, then refresh the touched events' digests.
  const jobs = await sql<{ id: string; data: { articleId: string; signalOnly?: boolean; regroup?: boolean } }[]>`
    SELECT id, data FROM pgboss.job WHERE name = 'events.group' AND state IN ('created', 'retry')
    ORDER BY priority DESC, created_on`;
  const stories = new Set<number>();
  for (const j of jobs) {
    const { articleId, signalOnly, regroup } = j.data;
    if (signalOnly && !(await settleNonEditorial(articleId)).group) bump("group:skipped");
    else {
      const r = await groupArticle(articleId, { signalOnly, regroup });
      bump(`group:${r.verdict}`);
      if (r.storyId && !r.verdict.startsWith("signal")) stories.add(r.storyId);
    }
    await sql`UPDATE pgboss.job SET state = 'completed', completed_on = now() WHERE id = ${j.id} AND name = 'events.group'`;
  }
  for (const s of stories) { await composeStoryDigest(s); bump("digest"); }

  // 3. Issues: every due one that is missing, plus today's refresh.
  const reports = await composeDueReports(new Date());

  // 4. Hot board: the worker re-ranked it every five minutes; without it the stored ranking goes stale.
  // computeHotRanking returns only id and entries; candidates (stories past the participant gate,
  // before the top-10 cut) comes from the row it stored.
  let hot: { id: number; entries: number; candidates: number } | { error: string };
  try {
    const { id, entries } = await computeHotRanking();
    const [row] = await sql<{ candidates: number }[]>`SELECT (evidence->>'candidates')::int AS candidates FROM hot_rankings WHERE id = ${id}`;
    hot = { id, entries, candidates: row?.candidates ?? 0 };
  } catch (e) { hot = { error: e instanceof Error ? e.message : String(e) }; }
  const ok = reports.failed.length === 0 && !("error" in hot);
  console.log(JSON.stringify({ ok, counts, reports, hot }));
  if (!ok) process.exitCode = 1;
} finally {
  await stopBoss();
  await closeDb();
}
