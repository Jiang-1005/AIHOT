// Brief datelines: a real leading calendar day is the original publication day. A clock or a note stays
// evidence. The import day and the discovery time are not written into published_at. The old exact-date
// check fails these samples; the new parser accepts them. Impossible days stay undated.
import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { beijingMidnight } from "@aihot/contracts/time";
import { LEGACY_EXACT_DATELINE, parseOriginalDateline } from "@aihot/industry/dateline";
import { featuredDatelineDay, featuredSlot } from "@aihot/industry/selection";
import { closeDb, sql } from "@aihot/backend/db";
import { STALE_ON_DISCOVERY_MS, decideTimeline, upsertMaterial } from "@aihot/backend/content/materials";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { buildScoreInput } from "@aihot/backend/editorial/analyze";
import type { AnalyzeInputArticle } from "@aihot/backend/editorial/input";
import { publishArticle } from "@aihot/backend/publication/publish";
import { composeDaily } from "@aihot/backend/reports/compose";
import { BRIEF_STALE_MS, importOneBriefItem, planBriefPublication } from "../scripts/brief-dateline.ts";
import { MORNING_20261125, OUT_OF_SCOPE_IDS, correctMorningUndated } from "../scripts/correct-brief-undated.ts";

const T = tag();
const SOURCE = `test-brief-dateline-${T}`;
const IMPORT_DAY = "2026-11-25";
const ORIGINAL_DAY = "2026-11-24";
const DISCOVERED = new Date("2026-11-25T01:49:00.000Z");
const ORIGINAL_AT = beijingMidnight(ORIGINAL_DAY);

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

  const scores = [60, 50, 40, 22];
  for (const [index, row] of MORNING_20261125.entries()) {
    const created = await upsertMaterial({
      id: row.id, sourceId: SOURCE, url: row.url, title: `今早 ${index} ${T}`, via: "import", publishedAt: null,
      backfill: `brief-${IMPORT_DAY}-undated`, discoveredAt: DISCOVERED, bodyText: `正文 ${T} ${index}`, bodyStatus: "ok",
    });
    await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, category, title_zh, summary_zh, score, selected)
      VALUES (${created.articleId}, 1, 'rule', 'pass', 'industry', ${`标题-${index}-${T}`}, ${`摘要-${index}-${T}`}, ${scores[index]!}, ${index === 0})`;
    await sql`UPDATE articles SET grouping_status = 'complete', grouped_at = ${DISCOVERED} WHERE id = ${created.articleId}`;
    await publishArticle(created.articleId, { releasedAt: DISCOVERED });
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

  const preview = await correctMorningUndated({ apply: false });
  assert.equal(preview.mode, "dry-run");
  assert.equal(preview.items.filter((item) => item.action === "would-update").length, 4);
  for (const item of preview.items) {
    assert.equal(item.dates.originalDay, ORIGINAL_DAY);
    assert.equal(item.dates.discoveredAt, DISCOVERED.toISOString());
    assert.equal(item.dates.importDay, IMPORT_DAY);
    assert.equal(item.after?.published_at, ORIGINAL_AT.toISOString());
    assert.equal(item.after?.publication_time, MORNING_20261125.find((row) => row.id === item.id)!.evidence);
    assert.equal(item.after?.timeline_at, DISCOVERED.toISOString());
    assert.equal(item.after?.backfill, false);
    assert.equal(item.after?.discovered_at, DISCOVERED.toISOString());
  }
  const [untouched] = await sql<{ published_at: Date | null }[]>`SELECT published_at FROM articles WHERE id = ${MORNING_20261125[0]!.id}`;
  assert.equal(untouched!.published_at, null);

  const applied = await correctMorningUndated({ apply: true });
  assert.equal(applied.mode, "apply");
  for (const [index, row] of MORNING_20261125.entries()) {
    const item = applied.items.find((entry) => entry.id === row.id)!;
    assert.equal(item.action, "updated");
    const [article] = await sql<{ published_at: Date; publication_time: string; discovered_at: Date; timeline_at: Date; backfill: boolean; backfill_reason: string | null }[]>`
      SELECT published_at, publication_time, discovered_at, timeline_at, backfill, backfill_reason FROM articles WHERE id = ${row.id}`;
    assert.equal(article!.published_at.toISOString(), ORIGINAL_AT.toISOString());
    assert.equal(article!.publication_time, row.evidence);
    assert.equal(article!.discovered_at.toISOString(), DISCOVERED.toISOString());
    assert.equal(article!.timeline_at.toISOString(), DISCOVERED.toISOString());
    assert.equal(article!.backfill, false);
    assert.equal(article!.backfill_reason, null);
    const [analysis] = await sql<{ score: number; selected: boolean }[]>`SELECT score, selected FROM analyses WHERE article_id = ${row.id}`;
    assert.equal(analysis!.score, scores[index]);
    assert.equal(analysis!.selected, index === 0);
    const [publication] = await sql<{ published_at: Date; timeline_at: Date; backfill: boolean; eligible: boolean; score: number; selected: boolean }[]>`
      SELECT published_at, timeline_at, backfill, eligible, score, selected FROM publications WHERE article_id = ${row.id}`;
    assert.equal(publication!.published_at.toISOString(), ORIGINAL_AT.toISOString());
    assert.equal(publication!.timeline_at.toISOString(), DISCOVERED.toISOString());
    assert.equal(publication!.backfill, false);
    assert.equal(publication!.eligible, true);
    assert.equal(publication!.score, scores[index]);
    const dateline = featuredDatelineDay({ url: row.url, publicationTime: row.evidence, publishedAt: publication!.published_at });
    assert.equal(dateline, ORIGINAL_DAY);
    assert.equal(publication!.selected, index === 0 && featuredSlot(dateline) !== "无");
    assert.equal(item.publicationAfter?.score, scores[index]);
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

  const second = await correctMorningUndated({ apply: true });
  assert.equal(second.items.every((item) => item.action === "unchanged"), true);
  const [republished] = await sql<{ published_at: Date; publication_time: string }[]>`
    SELECT published_at, publication_time FROM articles WHERE id = ${MORNING_20261125[0]!.id}`;
  assert.equal(republished!.published_at.toISOString(), ORIGINAL_AT.toISOString());
  assert.equal(republished!.publication_time, MORNING_20261125[0]!.evidence);
});
