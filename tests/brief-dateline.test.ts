// Brief datelines: a real leading calendar day is the original publication day. A clock or a note stays
// evidence. The import day and the discovery time are not written into published_at. The old exact-date
// check fails these samples; the new parser accepts them. Impossible days stay undated.
import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { beijingMidnight } from "@aihot/contracts/time";
import { LEGACY_EXACT_DATELINE, parseOriginalDateline } from "@aihot/industry/dateline";
import { publishArticle } from "@aihot/backend/publication/publish";
import { featuredDatelineDay, featuredSlot } from "@aihot/industry/selection";
import { closeDb, sql } from "@aihot/backend/db";
import { STALE_ON_DISCOVERY_MS, decideTimeline, upsertMaterial } from "@aihot/backend/content/materials";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { buildScoreInput } from "@aihot/backend/editorial/analyze";
import type { AnalyzeInputArticle } from "@aihot/backend/editorial/input";
import { composeDaily } from "@aihot/backend/reports/compose";
import { BRIEF_STALE_MS, importOneBriefItem, planBriefPublication } from "../scripts/brief-dateline.ts";
import { CORRECTION_BOUNDARY, MORNING_20261125, OUT_OF_SCOPE_IDS, correctMorningUndated } from "../scripts/correct-brief-undated.ts";

const T = tag();
const SOURCE = `test-brief-dateline-${T}`;
const IMPORT_DAY = "2026-11-25";
const ORIGINAL_DAY = "2026-11-24";
const DISCOVERED = new Date("2026-11-25T01:49:00.000Z");
const ORIGINAL_AT = beijingMidnight(ORIGINAL_DAY);
const RELATIONS = JSON.parse(readFileSync(new URL("./fixtures/morning-20261125-relations.json", import.meta.url), "utf8")) as {
  collected_at_bj: string;
  items: Array<{
    article: { id: string; url: string; published_at: null; publication_time: null; discovered_at: string; timeline_at: string; backfill: boolean; backfill_reason: string };
    publication: { fact_id: null; selected: boolean; seat: boolean; eligible: boolean; score: number; published_at: null };
    selected_ledger: unknown[];
    selected_state: null;
  }>;
  fact_membership: { fact_articles_by_article_id: unknown[] };
  replay_placeholders_not_in_snapshot: {
    note: string;
    body: string;
    title_prefix: string;
    summary: string;
    analysis_selected: Record<string, boolean>;
  };
};

function runCli(args: string[]): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, [fileURLToPath(new URL("../scripts/correct-brief-undated.ts", import.meta.url)), ...args], {
      encoding: "utf8",
      env: process.env,
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    const err = error as { status?: number | null; stdout?: string; stderr?: string };
    return { status: err.status ?? 1, stdout: String(err.stdout ?? ""), stderr: String(err.stderr ?? "") };
  }
}

after(async () => {
  await stopBoss();
  await closeDb();
});

test("the old exact-date check rejects annotated datelines, and a real calendar day is kept", () => {
  assert.equal(BRIEF_STALE_MS, STALE_ON_DISCOVERY_MS);
  for (const row of MORNING_20261125) {
    assert.equal(LEGACY_EXACT_DATELINE.test(row.evidence), false, row.evidence);
    const parsed = parseOriginalDateline(row.evidence);
    assert.equal(parsed?.day, ORIGINAL_DAY, row.evidence);
    assert.equal(parsed?.evidence, row.evidence);
    assert.equal(parsed?.publishedAt.toISOString(), ORIGINAL_AT.toISOString());
    assert.equal(featuredDatelineDay({ publicationTime: row.evidence, publishedAt: parsed?.publishedAt }), ORIGINAL_DAY);
  }
  assert.equal(parseOriginalDateline("2026-11-24")?.publishedAt.toISOString(), ORIGINAL_AT.toISOString());
  assert.equal(parseOriginalDateline("2026-11-24 19:55")?.day, ORIGINAL_DAY);
  assert.equal(featuredDatelineDay({ publicationTime: "2026-11-24 19:55" }), ORIGINAL_DAY, "a clock is not parsed as a UTC instant");
  assert.equal(featuredDatelineDay({ publicationTime: "2026-11-24T20:00:00.000Z" }), "2026-11-25", "an ISO instant still uses its Beijing day");
  assert.equal(parseOriginalDateline("2026-11-24T20:00:00.000Z"), null);

  for (const raw of ["2026-02-30", "2026-02-29", "2026-13-01", "2026-11-31", "2026-00-10", "not-a-date", "11/24/2026", "  ", ""]) {
    assert.equal(parseOriginalDateline(raw), null, JSON.stringify(raw));
  }
  assert.equal(LEGACY_EXACT_DATELINE.test("2026-02-30"), true, "the old check matched an impossible day");
  assert.equal(parseOriginalDateline("2024-02-29")?.day, "2024-02-29");

  const fresh = planBriefPublication(MORNING_20261125[0]!.evidence, IMPORT_DAY, DISCOVERED);
  assert.equal(fresh.day, ORIGINAL_DAY);
  assert.equal(fresh.publicationTime, MORNING_20261125[0]!.evidence);
  assert.equal(fresh.backfill, null);
  assert.equal(fresh.slot, "featured");
  const decision = decideTimeline(fresh.publishedAt, DISCOVERED, fresh.backfill);
  assert.equal(decision.backfill, false);
  assert.equal(decision.timelineAt.toISOString(), DISCOVERED.toISOString());
  assert.notEqual(beijingMidnight(IMPORT_DAY).toISOString(), fresh.publishedAt?.toISOString());

  const stale = planBriefPublication("2026-10-01（旧稿）", IMPORT_DAY, DISCOVERED);
  assert.equal(stale.day, "2026-10-01");
  assert.equal(stale.backfill, `brief-${IMPORT_DAY}`);
  assert.equal(decideTimeline(stale.publishedAt, DISCOVERED, stale.backfill).timelineAt.toISOString(), beijingMidnight("2026-10-01").toISOString());

  const exactly = planBriefPublication(ORIGINAL_DAY, IMPORT_DAY, new Date(ORIGINAL_AT.getTime() + BRIEF_STALE_MS));
  assert.equal(exactly.backfill, null, "48 hours on the dot is still news");
  const past = planBriefPublication(ORIGINAL_DAY, IMPORT_DAY, new Date(ORIGINAL_AT.getTime() + BRIEF_STALE_MS + 1));
  assert.equal(past.backfill, `brief-${IMPORT_DAY}`);

  assert.equal(planBriefPublication("", IMPORT_DAY, DISCOVERED).slot, "undated");
  assert.equal(planBriefPublication("2026-02-30", IMPORT_DAY, DISCOVERED).publicationTime, null);
  assert.equal(planBriefPublication("2026-02-30", IMPORT_DAY, DISCOVERED).backfill, `brief-${IMPORT_DAY}-undated`);

  const scoreInput = (publicationTime: string): AnalyzeInputArticle => ({
    id: "x", revision: 1, title: "标题", url: "https://example.com/a", author: null, publishedAt: ORIGINAL_AT, publicationTime,
    bodyText: "正文", excerpt: null, xPost: null, media: [], source: { name: "媒体", kind: "external", tier: "T2", firstParty: false },
  });
  const noted = buildScoreInput(scoreInput("2026-11-24（页面日期；RSS为2026-11-24T08:00:00+08:00）"));
  assert.match(noted, /2026-11-24（页面日期/);
  assert.doesNotMatch(noted, /T00:00:00\+08:00/);
  const isoAt = new Date("2026-11-24T11:55:00.000Z");
  const iso = buildScoreInput({ ...scoreInput("2026-11-24T11:55:00.000Z"), publishedAt: isoAt });
  assert.match(iso, /2026-11-24T19:55:00\+08:00/);
});

test("annotated datelines import as the original day, and an existing URL is not rewritten", async () => {
  const now = DISCOVERED;
  const row = {
    标题: `希沃样本 ${T}`,
    媒体: `测试媒体${T}`,
    落款日期: MORNING_20261125[0]!.evidence,
    事实摘要: "事实摘要足够长，用来形成一条可导入的正文。".repeat(3),
    原文链接: `https://example.com/brief-dateline/${T}`,
  };
  const first = await importOneBriefItem({ row, url: row.原文链接, norm: row.原文链接, briefDate: IMPORT_DAY, now });
  assert.equal(first.created, true);
  assert.equal(first.slot, "featured");
  const [stored] = await sql<{ published_at: Date; publication_time: string; discovered_at: Date; timeline_at: Date; backfill: boolean; backfill_reason: string | null }[]>`
    SELECT published_at, publication_time, discovered_at, timeline_at, backfill, backfill_reason FROM articles WHERE id = ${first.articleId!}`;
  assert.equal(stored!.published_at.toISOString(), ORIGINAL_AT.toISOString());
  assert.equal(stored!.publication_time, row.落款日期);
  assert.equal(stored!.discovered_at.toISOString(), now.toISOString());
  assert.equal(stored!.timeline_at.toISOString(), now.toISOString());
  assert.equal(stored!.backfill, false);
  assert.equal(stored!.backfill_reason, null);

  const again = await importOneBriefItem({
    row: { ...row, 落款日期: "2026-11-20", 标题: "另一个标题" },
    url: row.原文链接, norm: row.原文链接, briefDate: IMPORT_DAY, now,
  });
  assert.equal(again.skipped, "duplicate url");
  const [still] = await sql<{ published_at: Date; publication_time: string; title: string }[]>`
    SELECT published_at, publication_time, title FROM articles WHERE id = ${first.articleId!}`;
  assert.equal(still!.published_at.toISOString(), ORIGINAL_AT.toISOString());
  assert.equal(still!.publication_time, row.落款日期);
  assert.equal(still!.title, row.标题);

  const held = `https://example.com/brief-dateline/${T}/held`;
  await upsertMaterial({
    sourceId: `ext-brief-测试媒体${T}`, url: held, title: "已入库无日期", via: "import", publishedAt: null,
    backfill: `brief-${IMPORT_DAY}-undated`, discoveredAt: now,
  });
  const skipped = await importOneBriefItem({
    row: { ...row, 原文链接: held, 落款日期: "2026-11-24" },
    url: held, norm: held, briefDate: IMPORT_DAY, now,
  });
  assert.equal(skipped.skipped, "duplicate url");
  const [heldRow] = await sql<{ published_at: Date | null; publication_time: string | null }[]>`
    SELECT published_at, publication_time FROM articles WHERE url = ${held}`;
  assert.equal(heldRow!.published_at, null);
  assert.equal(heldRow!.publication_time, null);

  const illegal = await importOneBriefItem({
    row: { ...row, 原文链接: `https://example.com/brief-dateline/${T}/illegal`, 落款日期: "2026-02-30" },
    url: `https://example.com/brief-dateline/${T}/illegal`, norm: `https://example.com/brief-dateline/${T}/illegal`, briefDate: IMPORT_DAY, now,
  });
  const [bad] = await sql<{ published_at: Date | null; publication_time: string | null; backfill_reason: string | null }[]>`
    SELECT published_at, publication_time, backfill_reason FROM articles WHERE id = ${illegal.articleId!}`;
  assert.equal(bad!.published_at, null);
  assert.equal(bad!.publication_time, null);
  assert.equal(bad!.backfill_reason, `brief-${IMPORT_DAY}-undated`);
});

test("only the four morning rows are corrected, then the window can be composed", async () => {
  const excluded = new Set<string>(OUT_OF_SCOPE_IDS);
  for (const row of MORNING_20261125) assert.equal(excluded.has(row.id), false);
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode, next_fetch_at)
    VALUES (${SOURCE}, 'Brief dateline', 'external', 'T2', 'editorial', '2100-01-01')`;

  await upsertMaterial({
    id: MORNING_20261125[0]!.id, sourceId: SOURCE, url: "https://example.com/not-the-whitelisted-url", title: "网址不符",
    via: "import", publishedAt: null, backfill: `brief-${IMPORT_DAY}-undated`, discoveredAt: DISCOVERED,
  });
  const mismatched = await correctMorningUndated({ apply: true });
  const mismatch = mismatched.items.find((item) => item.id === MORNING_20261125[0]!.id)!;
  assert.equal(mismatch.action, "skipped");
  assert.equal(mismatch.reason, "url does not match the whitelist");
  const [wrongUrl] = await sql<{ published_at: Date | null; url: string }[]>`
    SELECT published_at, url FROM articles WHERE id = ${MORNING_20261125[0]!.id}`;
  assert.equal(wrongUrl!.published_at, null);
  assert.equal(wrongUrl!.url, "https://example.com/not-the-whitelisted-url");
  await sql`DELETE FROM articles WHERE id = ${MORNING_20261125[0]!.id}`;

  const placeholders = RELATIONS.replay_placeholders_not_in_snapshot;
  assert.equal(RELATIONS.collected_at_bj, "2026-11-25 11:13:21");
  assert.equal(RELATIONS.fact_membership.fact_articles_by_article_id.length, 0);
  for (const snap of RELATIONS.items) {
    const row = MORNING_20261125.find((entry) => entry.id === snap.article.id)!;
    assert.equal(snap.article.url, row.url);
    assert.equal(snap.article.published_at, null);
    assert.equal(snap.article.publication_time, null);
    assert.equal(snap.publication.fact_id, null);
    assert.equal(snap.publication.selected, false);
    assert.equal(snap.publication.eligible, false);
    assert.equal(snap.publication.seat, true);
    assert.equal(snap.selected_ledger.length, 0);
    assert.equal(snap.selected_state, null);
    const discovered = new Date(snap.article.discovered_at);
    const created = await upsertMaterial({
      id: row.id, sourceId: SOURCE, url: row.url, title: `${placeholders.title_prefix} ${row.id}`, via: "import",
      publishedAt: null, backfill: snap.article.backfill_reason, discoveredAt: discovered,
      bodyText: placeholders.body, bodyStatus: "ok",
    });
    await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, category, title_zh, summary_zh, score, selected)
      VALUES (${created.articleId}, 1, 'rule', 'pass', 'industry', ${`${placeholders.title_prefix} ${row.id}`}, ${placeholders.summary}, ${snap.publication.score}, ${placeholders.analysis_selected[row.id]})`;
    await sql`UPDATE articles SET grouping_status = 'complete', grouped_at = ${discovered} WHERE id = ${created.articleId}`;
    await publishArticle(created.articleId, { releasedAt: discovered });
    await sql`UPDATE articles SET published_at = NULL, published_at_claim = NULL, publication_time = NULL, discovered_at = ${discovered}, timeline_at = ${discovered}, backfill = true, backfill_reason = ${snap.article.backfill_reason} WHERE id = ${row.id}`;
    await sql`UPDATE publications SET published_at = NULL, timeline_at = ${discovered}, backfill = true, selected = false, eligible = false, seat = true, score = ${snap.publication.score}, fact_id = NULL, story_id = NULL WHERE article_id = ${row.id}`;
    await sql`DELETE FROM selected_ledger WHERE article_id = ${row.id}`;
    await sql`DELETE FROM selected_state WHERE article_id = ${row.id}`;
    await sql`DELETE FROM fact_articles WHERE article_id = ${row.id}`;
  }

  const historical = [
    ["g5lpl1lg4uh4ksiccl2vsfrb2", "https://example.com/historical/jiuzhang"],
    ["h2e8klqnhz37sk0ive18sdn3z", "https://example.com/historical/khan"],
    ["hg8j0c1wxf3whj5gss1mymsk2", "https://example.com/historical/guangzhou"],
    ["czggqw5dce9inzajc3o8rt84e", "https://example.com/historical/ecc"],
    ["ghwvr26vr8az3jj4jgkbrq37m", "https://example.com/historical/voicetube"],
  ] as const;
  for (const [id, url] of historical) {
    await upsertMaterial({
      id, sourceId: SOURCE, url, title: id, via: "import", publishedAt: null,
      backfill: "brief-2026-11-24-undated", discoveredAt: new Date("2026-11-24T05:09:00.000Z"),
    });
  }
  await upsertMaterial({
    id: "xaawa97ajl31a74bq0grzs0tx", sourceId: SOURCE, url: "https://example.com/historical/doushen", title: "豆神",
    via: "import", publishedAt: beijingMidnight("2026-11-23"), discoveredAt: new Date("2026-11-24T05:09:47.000Z"),
  });
  await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, title_zh, summary_zh, score, selected)
    VALUES ('xaawa97ajl31a74bq0grzs0tx', 1, 'rule', 'block', '豆神', '摘要', NULL, false)`;
  const outsider = "outsiderbriefundated01";
  const outsiderAt = new Date("2098-08-02T01:00:00.000Z");
  await upsertMaterial({
    id: outsider, sourceId: SOURCE, url: `https://example.com/brief-dateline/${T}/outsider`, title: "白名单外",
    via: "import", publishedAt: null, backfill: `brief-${IMPORT_DAY}-undated`, discoveredAt: outsiderAt,
  });
  await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, category, title_zh, summary_zh, score, selected)
    VALUES (${outsider}, 1, 'rule', 'pass', 'industry', '白名单外', '摘要', 80, true)`;
  await sql`UPDATE articles SET grouping_status = 'complete' WHERE id = ${outsider}`;
  await publishArticle(outsider, { releasedAt: outsiderAt });

  await assert.rejects(composeDaily(IMPORT_DAY, "featured-updated"), /nothing judged/);
  await assert.rejects(composeDaily("2098-08-01", "featured-updated"), /nothing judged/);
  await assert.rejects(composeDaily("2098-08-02", "featured-updated"), /nothing judged/);

  const watched = async () => ({
    articles: await sql`SELECT id, published_at, publication_time, discovered_at, timeline_at, backfill, backfill_reason FROM articles ORDER BY id`,
    publications: await sql`SELECT article_id, published_at, timeline_at, backfill, eligible, selected, seat, score, fact_id FROM publications ORDER BY article_id`,
    ledger: await sql`SELECT article_id, op FROM selected_ledger ORDER BY seq, article_id`,
    state: await sql`SELECT article_id, in_set FROM selected_state ORDER BY article_id`,
    facts: await sql`SELECT fact_id, article_id, role FROM fact_articles ORDER BY fact_id, article_id`,
    jobs: (await sql<{ present: string | null }[]>`SELECT to_regclass('pgboss.job') AS present`)[0]?.present
      ? await sql`SELECT name, state, data->>'articleId' AS article_id FROM pgboss.job WHERE name IN ('notify.selected', 'media.prepare') ORDER BY name, id`
      : [],
  });
  const before = await watched();
  const preview = await correctMorningUndated({ apply: false });
  assert.equal(preview.boundary.notifySelected.includes("not enqueued"), true);
  assert.deepEqual(await watched(), before, "dry-run writes nothing");
  await assert.rejects(correctMorningUndated({ apply: true, injectFailureAfter: 1 }), /injected failure before commit/);
  assert.deepEqual(await watched(), before, "a failure during projection rolls the batch back");
  assert.equal(preview.mode, "dry-run");
  assert.equal(preview.items.filter((item) => item.action === "would-update").length, 4);
  for (const item of preview.items) {
    const snap = RELATIONS.items.find((entry) => entry.article.id === item.id)!;
    assert.equal(item.dates.originalDay, ORIGINAL_DAY);
    assert.equal(item.dates.discoveredAt, new Date(snap.article.discovered_at).toISOString());
    assert.equal(item.dates.importDay, IMPORT_DAY);
    assert.equal(item.after?.published_at, ORIGINAL_AT.toISOString());
    assert.equal(item.after?.publication_time, MORNING_20261125.find((row) => row.id === item.id)!.evidence);
    assert.equal(item.after?.timeline_at, new Date(snap.article.discovered_at).toISOString());
    assert.equal(item.after?.backfill, false);
    assert.equal(item.after?.discovered_at, new Date(snap.article.discovered_at).toISOString());
  }
  const [untouched] = await sql<{ published_at: Date | null }[]>`SELECT published_at FROM articles WHERE id = ${MORNING_20261125[0]!.id}`;
  assert.equal(untouched!.published_at, null);
  const cliDry = runCli([]);
  assert.equal(cliDry.status, 0, cliDry.stderr);
  assert.equal(JSON.parse(cliDry.stdout).mode, "dry-run");
  assert.deepEqual(await watched(), before, "default CLI writes nothing");
  const cliUnknown = runCli(["--nope"]);
  assert.notEqual(cliUnknown.status, 0);
  assert.match(cliUnknown.stderr, /unknown argument/);
  assert.deepEqual(await watched(), before, "an unknown CLI argument writes nothing");

  const target = MORNING_20261125[0]!;
  const peer = "fakerepnotsnapshot0001";
  await upsertMaterial({
    id: peer, sourceId: SOURCE, url: `https://example.invalid/fake-representative/${T}`, title: "FAKE peer not from the 11:13 snapshot",
    via: "import", publishedAt: beijingMidnight("2026-11-20"), discoveredAt: new Date("2026-11-20T02:00:00.000Z"),
    bodyText: "FAKE body not from the 11:13 snapshot", bodyStatus: "ok",
  });
  await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, category, title_zh, summary_zh, score, selected)
    VALUES (${peer}, 1, 'rule', 'pass', 'industry', 'FAKE peer', 'FAKE summary not from the snapshot', 70, true)`;
  await sql`UPDATE articles SET grouping_status = 'complete' WHERE id = ${peer}`;
  await publishArticle(peer, { releasedAt: new Date("2026-11-20T02:00:00.000Z") });
  const [fact] = await sql<{ id: number }[]>`
    INSERT INTO facts (public_id, title) VALUES (${`fake-conflict-not-snapshot-${T}`}, 'FAKE fact not from the 11:13 snapshot') RETURNING id`;
  await sql`INSERT INTO fact_articles (fact_id, article_id, role) VALUES (${fact!.id}, ${target.id}, 'primary'), (${fact!.id}, ${peer}, 'report')`;
  await sql`UPDATE publications SET fact_id = ${fact!.id}, selected = true, seat = true, eligible = true WHERE article_id = ${peer}`;
  await sql`UPDATE publications SET fact_id = ${fact!.id} WHERE article_id = ${target.id}`;
  const conflictBefore = await watched();
  const conflictDry = runCli([]);
  assert.equal(conflictDry.status, 0, conflictDry.stderr);
  const conflictPreview = JSON.parse(conflictDry.stdout) as { items: Array<{ id: string; action: string; reason: string }> };
  const refused = conflictPreview.items.find((item) => item.id === target.id)!;
  assert.equal(refused.action, "refused");
  assert.match(refused.reason, /representative boundary: fact .* refusing a second seat/);
  assert.deepEqual(await watched(), conflictBefore, "dry-run of a representative conflict writes nothing");
  const conflictApply = runCli(["--apply"]);
  assert.notEqual(conflictApply.status, 0);
  assert.match(conflictApply.stderr, /representative boundary: fact .* refusing a second seat/);
  assert.deepEqual(await watched(), conflictBefore, "apply of a representative conflict rolls back");
  const [peerSeat] = await sql<{ seat: boolean; selected: boolean }[]>`SELECT seat, selected FROM publications WHERE article_id = ${peer}`;
  assert.equal(peerSeat!.seat, true);
  assert.equal(peerSeat!.selected, true);
  const [stillUndated] = await sql<{ published_at: Date | null }[]>`SELECT published_at FROM articles WHERE id = ${target.id}`;
  assert.equal(stillUndated!.published_at, null);
  const dual = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM publications
    WHERE fact_id = ${fact!.id} AND selected AND seat AND visibility = 'public'`;
  assert.equal(dual[0]!.n, 1, "the refusal leaves a single representative");

  await sql`DELETE FROM fact_articles WHERE fact_id = ${fact!.id}`;
  await sql`UPDATE publications SET fact_id = NULL WHERE article_id = ${target.id}`;
  await sql`DELETE FROM selected_ledger WHERE article_id = ${peer}`;
  await sql`DELETE FROM selected_state WHERE article_id = ${peer}`;
  await sql`DELETE FROM publications WHERE article_id = ${peer}`;
  await sql`DELETE FROM articles WHERE id = ${peer}`;
  await sql`DELETE FROM facts WHERE id = ${fact!.id}`;
  await sql`UPDATE publications SET seat = false WHERE article_id = ${target.id}`;
  const missingBefore = await watched();
  const missingApply = runCli(["--apply"]);
  assert.notEqual(missingApply.status, 0);
  assert.match(missingApply.stderr, /representative boundary: no fact and selected, but the seat is false/);
  assert.deepEqual(await watched(), missingBefore, "a selected article with no seat is refused instead of omitting the ledger");
  const [missingSeat] = await sql<{ seat: boolean; published_at: Date | null }[]>`
    SELECT p.seat, a.published_at FROM publications p JOIN articles a ON a.id = p.article_id WHERE p.article_id = ${target.id}`;
  assert.equal(missingSeat!.seat, false);
  assert.equal(missingSeat!.published_at, null);
  await sql`UPDATE publications SET seat = true WHERE article_id = ${target.id}`;
  assert.deepEqual(await watched(), before, "the fake conflict is gone and the snapshot rows are unchanged");

  const cliApply = runCli(["--apply"]);
  assert.equal(cliApply.status, 0, cliApply.stderr);
  const applied = JSON.parse(cliApply.stdout) as { mode: string; items: Array<{ id: string; action: string; publicationAfter: { score: number; selected: boolean; seat: boolean; eligible: boolean; fact_id: number | null } | null }> };
  assert.equal(applied.mode, "apply");
  const replay: unknown[] = [];
  for (const row of MORNING_20261125) {
    const snap = RELATIONS.items.find((entry) => entry.article.id === row.id)!;
    const item = applied.items.find((entry) => entry.id === row.id)!;
    assert.equal(item.action, "updated");
    const discovered = new Date(snap.article.discovered_at);
    const [article] = await sql<{ published_at: Date; publication_time: string; discovered_at: Date; timeline_at: Date; backfill: boolean; backfill_reason: string | null }[]>`
      SELECT published_at, publication_time, discovered_at, timeline_at, backfill, backfill_reason FROM articles WHERE id = ${row.id}`;
    assert.equal(article!.published_at.toISOString(), ORIGINAL_AT.toISOString());
    assert.equal(article!.publication_time, row.evidence);
    assert.equal(article!.discovered_at.getTime(), discovered.getTime());
    assert.equal(article!.timeline_at.getTime(), discovered.getTime());
    assert.equal(article!.backfill, false);
    assert.equal(article!.backfill_reason, null);
    const [analysis] = await sql<{ score: number; selected: boolean }[]>`SELECT score, selected FROM analyses WHERE article_id = ${row.id}`;
    assert.equal(Number(analysis!.score), snap.publication.score);
    assert.equal(analysis!.selected, placeholders.analysis_selected[row.id]);
    const [publication] = await sql<{ published_at: Date; timeline_at: Date; backfill: boolean; eligible: boolean; score: number; selected: boolean; seat: boolean; fact_id: number | null }[]>`
      SELECT published_at, timeline_at, backfill, eligible, score, selected, seat, fact_id FROM publications WHERE article_id = ${row.id}`;
    assert.equal(publication!.published_at.toISOString(), ORIGINAL_AT.toISOString());
    assert.equal(publication!.timeline_at.getTime(), discovered.getTime());
    assert.equal(publication!.backfill, false);
    assert.equal(publication!.eligible, true);
    assert.equal(Number(publication!.score), snap.publication.score);
    assert.equal(publication!.seat, true);
    assert.equal(publication!.fact_id, null);
    const dateline = featuredDatelineDay({ url: row.url, publicationTime: row.evidence, publishedAt: publication!.published_at });
    assert.equal(dateline, ORIGINAL_DAY);
    const expectSelected = placeholders.analysis_selected[row.id] === true && featuredSlot(dateline) !== "无";
    assert.equal(publication!.selected, expectSelected);
    assert.equal(item.publicationAfter?.score, snap.publication.score);
    assert.equal(item.publicationAfter?.selected, expectSelected);
    assert.equal(item.publicationAfter?.seat, true);
    assert.equal(item.publicationAfter?.fact_id, null);
    const ledger = await sql<{ op: string }[]>`SELECT op FROM selected_ledger WHERE article_id = ${row.id} ORDER BY seq`;
    const state = await sql<{ in_set: boolean }[]>`SELECT in_set FROM selected_state WHERE article_id = ${row.id}`;
    const facts = await sql`SELECT fact_id FROM fact_articles WHERE article_id = ${row.id}`;
    assert.equal(facts.length, 0);
    if (expectSelected) {
      assert.deepEqual(ledger.map((entry) => entry.op), ["upsert"]);
      assert.equal(state.length, 1);
      assert.equal(state[0]!.in_set, true);
    } else {
      assert.equal(ledger.length, 0);
      assert.equal(state.length, 0);
    }
    replay.push({
      id: row.id,
      snapshotDiscoveredAt: snap.article.discovered_at,
      originalDay: ORIGINAL_DAY,
      discoveredAt: article!.discovered_at.toISOString(),
      timelineAt: article!.timeline_at.toISOString(),
      publishedAt: article!.published_at.toISOString(),
      publicationTime: article!.publication_time,
      eligible: publication!.eligible,
      selected: publication!.selected,
      seat: publication!.seat,
      factId: publication!.fact_id,
      score: Number(publication!.score),
      analysisSelectedPlaceholder: placeholders.analysis_selected[row.id],
      ledger: ledger.map((entry) => entry.op),
      state: state[0]?.in_set ?? null,
    });
  }

  for (const [id] of historical) {
    const [row] = await sql<{ published_at: Date | null; publication_time: string | null; backfill_reason: string | null }[]>`
      SELECT published_at, publication_time, backfill_reason FROM articles WHERE id = ${id}`;
    assert.equal(row!.published_at, null);
    assert.equal(row!.publication_time, null);
    assert.equal(row!.backfill_reason, "brief-2026-11-24-undated");
  }
  const [doushen] = await sql<{ published_at: Date; backfill: boolean }[]>`
    SELECT published_at, backfill FROM articles WHERE id = 'xaawa97ajl31a74bq0grzs0tx'`;
  assert.equal(doushen!.published_at.toISOString(), beijingMidnight("2026-11-23").toISOString());
  assert.equal(doushen!.backfill, false);
  const [outside] = await sql<{ published_at: Date | null; backfill_reason: string | null }[]>`
    SELECT published_at, backfill_reason FROM articles WHERE id = ${outsider}`;
  assert.equal(outside!.published_at, null);
  assert.equal(outside!.backfill_reason, `brief-${IMPORT_DAY}-undated`);

  const issue = await composeDaily(IMPORT_DAY, "featured-updated");
  assert.equal(issue.key, IMPORT_DAY);
  const [report] = await sql<{ content: { generator: { judgedReports: number } } }[]>`
    SELECT content FROM reports WHERE kind = 'daily' AND key = ${IMPORT_DAY}`;
  assert.equal(report!.content.generator.judgedReports, 4);
  await assert.rejects(composeDaily("2098-08-01", "featured-updated"), /nothing judged/);
  await assert.rejects(composeDaily("2098-08-02", "featured-updated"), /nothing judged/);

  const after = await watched();
  const allowed = new Set<string>(MORNING_20261125.map((row) => row.id));
  const pubs = (rows: unknown) => (rows as Array<{ article_id: string }>).filter((row) => !allowed.has(row.article_id));
  assert.deepEqual(pubs(after.publications), pubs(before.publications));
  const foreign = (rows: unknown) => (rows as Array<{ article_id: string }>).filter((row) => !allowed.has(row.article_id));
  assert.deepEqual(foreign(after.ledger), foreign(before.ledger));
  assert.deepEqual(foreign(after.state), foreign(before.state));
  assert.deepEqual(after.facts, before.facts);
  assert.deepEqual(after.jobs, before.jobs);
  const jobsBeforeRepublish = after.jobs;
  await publishArticle(MORNING_20261125[0]!.id);
  const jobsAfterRepublish = (await sql<{ present: string | null }[]>`SELECT to_regclass('pgboss.job') AS present`)[0]?.present
    ? await sql`SELECT name, state, data->>'articleId' AS article_id FROM pgboss.job WHERE name IN ('notify.selected', 'media.prepare') ORDER BY name, id`
    : [];
  assert.deepEqual(jobsAfterRepublish, jobsBeforeRepublish, "a later ordinary republish does not enqueue a push");
  for (const id of [...historical.map(([historicalId]) => historicalId), "xaawa97ajl31a74bq0grzs0tx", outsider]) {
    const left = (before.articles as unknown as Array<{ id: string }>).find((row) => row.id === id);
    const right = (after.articles as unknown as Array<{ id: string }>).find((row) => row.id === id);
    assert.deepEqual(right, left, id);
  }
  const representatives = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM publications
    WHERE article_id = ANY(${MORNING_20261125.map((row) => row.id)}::text[]) AND selected AND seat`;
  assert.equal(representatives[0]!.n, replay.filter((row) => (row as { selected: boolean }).selected).length);
  const cliAgain = runCli(["--apply"]);
  assert.equal(cliAgain.status, 0, cliAgain.stderr);
  const second = JSON.parse(cliAgain.stdout) as { items: Array<{ action: string }> };
  assert.equal(second.items.every((item) => item.action === "unchanged"), true);
  console.log(JSON.stringify({
    label: "ISOLATED REPLAY of the 2026-11-25 11:13:21 local snapshot. Not production. Not Neon. Body and analysis.selected are placeholders.",
    fixture: "tests/fixtures/morning-20261125-relations.json",
    placeholderNote: placeholders.note,
    boundary: CORRECTION_BOUNDARY,
    judgedReports: report!.content.generator.judgedReports,
    items: replay,
    conflict: {
      label: "FAKE same-fact representative, not from the snapshot",
      dryRunAction: refused.action,
      dryRunReason: refused.reason,
      applyStatus: conflictApply.status,
      applyStderr: conflictApply.stderr.trim(),
      peerSeatStayedTrue: true,
      ordinaryRepresentativesAfterRefusal: 1,
    },
    missingLedger: {
      label: "FAKE selected article with seat false and no fact, not from the snapshot",
      applyStatus: missingApply.status,
      applyStderr: missingApply.stderr.trim(),
    },
    cli: {
      defaultDryRunStatus: cliDry.status,
      unknownArgumentStatus: cliUnknown.status,
      applyStatus: cliApply.status,
      rerunStatus: cliAgain.status,
      rerunActions: second.items.map((item) => item.action),
    },
    laterOrdinaryPublishEnqueuedNotify: false,
  }, null, 2));
  const [republished] = await sql<{ published_at: Date; publication_time: string }[]>`
    SELECT published_at, publication_time FROM articles WHERE id = ${MORNING_20261125[0]!.id}`;
  assert.equal(republished!.published_at.toISOString(), ORIGINAL_AT.toISOString());
  assert.equal(republished!.publication_time, MORNING_20261125[0]!.evidence);
});
