// One correction for the four industry rows imported on the morning of 2026-11-25.
// Their datelines had a clock or a note, the old importer stored no publication day, and a second
// import skips an existing URL. This does not scan the table and does not touch any other row.
//
// Default is dry-run. --apply writes only a whitelisted row that is still the old undated error.
// 原发日 comes from the cell below. 发现日 (discovered_at) is not changed. 导入日 stays in the
// before-snapshot's backfill_reason and is not written into published_at.
//
//   node scripts/correct-brief-undated.ts
//   node scripts/correct-brief-undated.ts --apply
import path from "node:path";
import { pathToFileURL } from "node:url";
import { LEGACY_EXACT_DATELINE, parseOriginalDateline } from "@aihot/industry/dateline";
import { closeDb, sql, type Sql, type Tx } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { decideTimeline, type TimelineDecision } from "@aihot/backend/content/materials";
import { featuredDatelineDay, featuredSlot } from "@aihot/industry/selection";
import { isIndexable, isPoolEligible, isSelectable } from "@aihot/backend/publication/rules";

export const MORNING_20261125 = [
  {
    id: "o8tgivmlcfbyh40rfo8fx9jtp",
    url: "https://www.36kr.com/p/4083350298924162",
    evidence: "2026-11-24 19:55（北京时间）",
  },
  {
    id: "rgfp34e6j0adksloeptwtuk73",
    url: "https://www.the74million.org/article/teaching-kids-to-read-is-important-so-is-teaching-them-to-communicate/",
    evidence: "2026-11-24（RSS 21:30 北京时间）",
  },
  {
    id: "s8gvat6l9u3pkc2v6esdxdyuj",
    url: "https://www.the74million.org/article/unpacking-lessons-learned-from-summit-learning-part-2/",
    evidence: "2026-11-24（RSS 23:30 北京时间）",
  },
  {
    id: "pa5go2ga4rcd7mj2i46y2rurc",
    url: "https://www.edsurge.com/news/how-one-teacher-prep-program-made-its-technology-use-visible",
    evidence: "2026-11-24（页面日期；RSS为2026-11-24T08:00:00+08:00）",
  },
] as const;

/** Last night's five undated rows and the 豆神 PDF block. Not selected, not queried. */
export const OUT_OF_SCOPE_IDS = [
  "g5lpl1lg4uh4ksiccl2vsfrb2",
  "h2e8klqnhz37sk0ive18sdn3z",
  "hg8j0c1wxf3whj5gss1mymsk2",
  "czggqw5dce9inzajc3o8rt84e",
  "ghwvr26vr8az3jj4jgkbrq37m",
  "xaawa97ajl31a74bq0grzs0tx",
] as const;

const OLD_UNDATED = /^brief-\d{4}-\d{2}-\d{2}-undated$/;

export function assertMorningWhitelist(): void {
  if (MORNING_20261125.length !== 4) throw new Error("the whitelist is not the four morning rows");
  const ids = new Set<string>();
  const urls = new Set<string>();
  for (const row of MORNING_20261125) {
    if (ids.has(row.id) || urls.has(row.url)) throw new Error(`duplicate whitelist entry ${row.id}`);
    if ((OUT_OF_SCOPE_IDS as readonly string[]).includes(row.id)) throw new Error(`whitelist overlaps an excluded id ${row.id}`);
    if (LEGACY_EXACT_DATELINE.test(row.evidence)) throw new Error(`${row.id} is a pure date; the old importer would have kept it`);
    const parsed = parseOriginalDateline(row.evidence);
    if (!parsed || parsed.day !== "2026-11-24") throw new Error(`${row.id} does not parse to the original day 2026-11-24`);
    ids.add(row.id);
    urls.add(row.url);
  }
}

type ArticleRow = {
  id: string;
  url: string;
  published_at: Date | null;
  published_at_claim: Date | null;
  publication_time: string | null;
  discovered_at: Date;
  timeline_at: Date;
  backfill: boolean;
  backfill_reason: string | null;
  updated_at: Date;
};

type PublicationRow = {
  article_id: string;
  published_at: Date | null;
  timeline_at: Date;
  backfill: boolean;
  score: number | null;
  eligible: boolean;
  selected: boolean;
};

export interface CorrectionItem {
  id: string;
  url: string;
  action: "would-update" | "updated" | "would-republish" | "republished" | "unchanged" | "skipped";
  reason: string;
  dates: { originalDay: string | null; discoveredAt: string | null; importDay: string | null };
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  publicationBefore: { published_at: string | null; timeline_at: string; backfill: boolean; score: number | null; eligible: boolean; selected: boolean } | null;
  publicationAfter: { published_at: string | null; timeline_at: string; backfill: boolean; score: number | null; eligible: boolean; selected: boolean } | null;
}

export interface CorrectionReport {
  mode: "dry-run" | "apply";
  whitelist: Array<{ id: string; url: string }>;
  excludedIds: readonly string[];
  boundary: typeof CORRECTION_BOUNDARY;
  items: CorrectionItem[];
  recovery: string;
}

const RECOVERY = "Restore only from each item's before snapshot: published_at, published_at_claim, publication_time, timeline_at, backfill, backfill_reason, updated_at, and that article's own publication columns. Do not copy discovered_at or the import day into published_at. This script does not restore, does not call republishTx, and does not change scores.";

/**
 * Normal publish (republishTx) also reseats every other report of the same fact, appends their
 * selected-sync ledger rows, and, when a backfill becomes selected, enqueues notifySelected and
 * prepareMedia. Those steps can write or notify outside the four rows. This correction does not
 * take them. It writes the whitelist article and that article's own publication (and its own
 * pool_search row). Another report's seat, ledger, and every queue stay as they were. A later
 * ordinary publish is what reseats a fact and sends a notification.
 */
export const CORRECTION_BOUNDARY = {
  republishTx: "not called",
  notifySelected: "not enqueued",
  prepareMedia: "not enqueued",
  otherPublications: "not updated",
  selectedLedger: "not written",
  productionFacts: "not read; this run has no production fact snapshot",
} as const;

function instant(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function sameInstant(a: Date | null | undefined, b: Date | null | undefined): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.getTime() === b.getTime();
}

function importDayOf(reason: string | null): string | null {
  const match = /^brief-(\d{4}-\d{2}-\d{2})(?:-undated)?$/.exec(reason ?? "");
  return match?.[1] ?? null;
}

function articleSnapshot(row: ArticleRow): Record<string, unknown> {
  return {
    published_at: instant(row.published_at),
    published_at_claim: instant(row.published_at_claim),
    publication_time: row.publication_time,
    discovered_at: row.discovered_at.toISOString(),
    timeline_at: row.timeline_at.toISOString(),
    backfill: row.backfill,
    backfill_reason: row.backfill_reason,
    updated_at: row.updated_at.toISOString(),
  };
}

function publicationSnapshot(row: PublicationRow | undefined) {
  if (!row) return null;
  return {
    published_at: instant(row.published_at),
    timeline_at: row.timeline_at.toISOString(),
    backfill: row.backfill,
    score: row.score,
    eligible: row.eligible,
    selected: row.selected,
  };
}

function isOldUndated(row: ArticleRow, url: string): boolean {
  return row.url === url
    && row.published_at === null
    && row.publication_time === null
    && row.backfill === true
    && OLD_UNDATED.test(row.backfill_reason ?? "");
}

function articleMatches(row: ArticleRow, decision: TimelineDecision, evidence: string): boolean {
  return sameInstant(row.published_at, decision.publishedAt)
    && sameInstant(row.published_at_claim, decision.publishedAt)
    && row.publication_time === evidence
    && sameInstant(row.timeline_at, decision.timelineAt)
    && row.backfill === decision.backfill
    && row.backfill_reason === decision.backfillReason;
}

function publicationMatches(row: PublicationRow | undefined, decision: TimelineDecision): boolean {
  if (!row) return false;
  return sameInstant(row.published_at, decision.publishedAt)
    && sameInstant(row.timeline_at, decision.timelineAt)
    && row.backfill === decision.backfill;
}

const ARTICLE_COLUMNS = sql`id, url, published_at, published_at_claim, publication_time, discovered_at, timeline_at, backfill, backfill_reason, updated_at`;

/** Projects the whitelist article's own publication. Does not reseat, ledger, or enqueue. */
async function projectOwnPublication(tx: Tx, articleId: string, now: Date): Promise<void> {
  const [row] = await tx<{
    published_at: Date | null; timeline_at: Date; backfill: boolean; grouping_status: string;
    selection_adds_value: boolean | null; url: string; publication_time: string | null;
    participation_mode: string; tier: string; relevance: string | null; title_zh: string | null;
    summary_zh: string | null; reason_zh: string | null; judged_selected: boolean | null;
    visible_after: Date | null; seo_indexed_at: Date | null; seo_excluded_at: Date | null;
    summary: string | null; title: string | null;
  }[]>`
    SELECT a.published_at, a.timeline_at, a.backfill, a.grouping_status, a.selection_adds_value,
      a.url, a.publication_time, s.participation_mode, s.tier,
      an.relevance, an.title_zh, an.summary_zh, an.reason_zh, an.selected AS judged_selected,
      p.visible_after, p.seo_indexed_at, p.seo_excluded_at, p.summary, p.title
    FROM articles a
    JOIN sources s ON s.id = a.source_id
    JOIN publications p ON p.article_id = a.id
    LEFT JOIN analyses an ON an.article_id = a.id
    WHERE a.id = ${articleId}
    ORDER BY an.input_revision DESC NULLS LAST, an.id DESC NULLS LAST
    LIMIT 1`;
  if (!row) throw new Error(`no publication to project for ${articleId}`);
  const eligible = isPoolEligible({
    participationMode: row.participation_mode, relevance: row.relevance, title: row.title_zh ?? row.title, summary: row.summary_zh ?? row.summary,
  }) && (!row.backfill || row.published_at !== null);
  const selectionCandidate = isSelectable(eligible, row.judged_selected, row.tier);
  const dateline = featuredDatelineDay({ url: row.url, publicationTime: row.publication_time, publishedAt: row.published_at });
  const selected = selectionCandidate && row.grouping_status === "complete" && row.selection_adds_value !== false && featuredSlot(dateline, now) !== "无";
  const visibleAfter = selected ? (row.visible_after ?? now) : null;
  const indexable = isIndexable({
    visibility: "public", sourceMode: row.participation_mode, hasSummary: !!(row.summary_zh ?? row.summary), selected,
    seoIndexedAt: row.seo_indexed_at, seoExcludedAt: row.seo_excluded_at,
  });
  const reason = selected ? row.reason_zh : null;
  await tx`UPDATE publications SET published_at = ${row.published_at}, timeline_at = ${row.timeline_at}, backfill = ${row.backfill},
    eligible = ${eligible}, selected = ${selected}, selection_candidate = ${selectionCandidate}, reason = ${reason},
    visible_after = ${visibleAfter}, sort_at = ${row.timeline_at}, indexable = ${indexable}, updated_at = now()
    WHERE article_id = ${articleId}`;
  if (eligible) {
    const direct = [row.title_zh ?? row.title, row.summary_zh ?? row.summary].filter(Boolean).join(" ").toLowerCase();
    await tx`INSERT INTO pool_search (article_id, direct, body) VALUES (${articleId}, ${direct}, '')
      ON CONFLICT (article_id) DO UPDATE SET direct = EXCLUDED.direct, body = EXCLUDED.body
      WHERE pool_search.direct IS DISTINCT FROM EXCLUDED.direct OR pool_search.body IS DISTINCT FROM EXCLUDED.body`;
  } else {
    await tx`DELETE FROM pool_search WHERE article_id = ${articleId}`;
  }
}

async function loadArticles(tx: Tx, ids: readonly string[], lock: boolean): Promise<ArticleRow[]> {
  if (lock) {
    return tx<ArticleRow[]>`SELECT ${ARTICLE_COLUMNS} FROM articles WHERE id = ANY(${ids}::text[]) ORDER BY id FOR UPDATE`;
  }
  return tx<ArticleRow[]>`SELECT ${ARTICLE_COLUMNS} FROM articles WHERE id = ANY(${ids}::text[]) ORDER BY id`;
}

export async function correctMorningUndated(options: { apply: boolean; db?: Sql; injectFailureAfter?: number }): Promise<CorrectionReport> {
  assertMorningWhitelist();
  const db = options.db ?? sql;
  const ids = MORNING_20261125.map((row) => row.id);
  return db.begin(async (tx) => {
    const articles = await loadArticles(tx, ids, options.apply);
    const byId = new Map(articles.map((row) => [row.id, row]));
    const publications = await tx<PublicationRow[]>`
      SELECT article_id, published_at, timeline_at, backfill, score, eligible, selected
      FROM publications WHERE article_id = ANY(${ids}::text[])`;
    const pubById = new Map(publications.map((row) => [row.article_id, row]));
    const items: CorrectionItem[] = [];
    for (const entry of MORNING_20261125) {
      const parsed = parseOriginalDateline(entry.evidence)!;
      const article = byId.get(entry.id);
      if (!article) {
        items.push(skipped(entry, "not in this database", null, undefined));
        continue;
      }
      const publication = pubById.get(entry.id);
      const before = articleSnapshot(article);
      const dates = {
        originalDay: parsed.day,
        discoveredAt: article.discovered_at.toISOString(),
        importDay: importDayOf(article.backfill_reason),
      };
      if (article.url !== entry.url) {
        items.push({ ...skipped(entry, "url does not match the whitelist", before, publication), dates });
        continue;
      }
      const decision = decideTimeline(parsed.publishedAt, article.discovered_at, null);
      if (!decision.publishedAt) {
        items.push({ ...skipped(entry, "parsed day is not a usable publication instant", before, publication), dates });
        continue;
      }
      const plannedArticle = articleMatches(article, decision, parsed.evidence);
      const plannedPublication = publicationMatches(publication, decision);
      if (plannedArticle && plannedPublication) {
        items.push(item(entry, options.apply ? "unchanged" : "unchanged", "already the corrected original day", dates, before, before, publication, publication));
        continue;
      }
      if (plannedArticle && !plannedPublication) {
        if (options.apply) await projectOwnPublication(tx, entry.id, new Date());
        items.push(item(
          entry,
          options.apply ? "republished" : "would-republish",
          "article already has the original day; own publication projected, no peer or notification",
          dates, before, before, publication, options.apply ? null : publication,
        ));
        continue;
      }
      if (!isOldUndated(article, entry.url)) {
        items.push({ ...skipped(entry, "not the old undated error", before, publication), dates });
        continue;
      }
      if (options.apply) {
        const updated = await tx<{ id: string }[]>`
          UPDATE articles SET
            published_at = ${decision.publishedAt},
            published_at_claim = ${decision.publishedAt},
            publication_time = ${parsed.evidence},
            timeline_at = ${decision.timelineAt},
            backfill = ${decision.backfill},
            backfill_reason = ${decision.backfillReason},
            updated_at = now()
          WHERE id = ${entry.id}
            AND url = ${entry.url}
            AND published_at IS NULL
            AND publication_time IS NULL
            AND backfill IS TRUE
            AND backfill_reason ~ '^brief-[0-9]{4}-[0-9]{2}-[0-9]{2}-undated$'
          RETURNING id`;
        if (updated.length !== 1) throw new Error(`refused to update ${entry.id}: it no longer matches the old undated error`);
        await projectOwnPublication(tx, entry.id, new Date());
        if (options.injectFailureAfter !== undefined && items.filter((row) => row.action === "updated").length + 1 === options.injectFailureAfter) {
          throw new Error("injected failure before commit");
        }
      }
      items.push(item(
        entry,
        options.apply ? "updated" : "would-update",
        "old undated dateline",
        dates, before, null, publication, null,
      ));
    }
    if (options.apply) {
      const afterArticles = await loadArticles(tx, ids, false);
      const afterPubs = await tx<PublicationRow[]>`
        SELECT article_id, published_at, timeline_at, backfill, score, eligible, selected
        FROM publications WHERE article_id = ANY(${ids}::text[])`;
      const afterById = new Map(afterArticles.map((row) => [row.id, row]));
      const afterPubById = new Map(afterPubs.map((row) => [row.article_id, row]));
      for (const entry of items) {
        if (entry.action !== "updated" && entry.action !== "republished") continue;
        const article = afterById.get(entry.id);
        const publication = afterPubById.get(entry.id);
        entry.after = article ? articleSnapshot(article) : null;
        entry.publicationAfter = publicationSnapshot(publication);
        if (entry.publicationBefore && entry.publicationAfter && entry.publicationBefore.score !== entry.publicationAfter.score) {
          throw new Error(`score changed for ${entry.id}`);
        }
      }
    } else {
      for (const entry of items) {
        if (entry.action !== "would-update") continue;
        const article = byId.get(entry.id)!;
        const parsed = parseOriginalDateline(MORNING_20261125.find((row) => row.id === entry.id)!.evidence)!;
        const decision = decideTimeline(parsed.publishedAt, article.discovered_at, null);
        entry.after = {
          ...entry.before,
          published_at: instant(decision.publishedAt),
          published_at_claim: instant(decision.publishedAt),
          publication_time: parsed.evidence,
          timeline_at: decision.timelineAt.toISOString(),
          backfill: decision.backfill,
          backfill_reason: decision.backfillReason,
          updated_at: entry.before?.updated_at ?? null,
        };
      }
    }
    return {
      mode: options.apply ? "apply" : "dry-run",
      whitelist: MORNING_20261125.map((row) => ({ id: row.id, url: row.url })),
      excludedIds: OUT_OF_SCOPE_IDS,
      boundary: CORRECTION_BOUNDARY,
      items,
      recovery: RECOVERY,
    } satisfies CorrectionReport;
  });
}

function skipped(
  entry: { id: string; url: string },
  reason: string,
  before: Record<string, unknown> | null,
  publication: PublicationRow | undefined,
): CorrectionItem {
  return item(entry, "skipped", reason, { originalDay: null, discoveredAt: null, importDay: null }, before, before, publication, publication);
}

function item(
  entry: { id: string; url: string },
  action: CorrectionItem["action"],
  reason: string,
  dates: CorrectionItem["dates"],
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  publicationBefore: PublicationRow | undefined,
  publicationAfter: PublicationRow | undefined | null,
): CorrectionItem {
  return {
    id: entry.id,
    url: entry.url,
    action,
    reason,
    dates,
    before,
    after,
    publicationBefore: publicationSnapshot(publicationBefore),
    publicationAfter: publicationAfter === null ? null : publicationSnapshot(publicationAfter),
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log("Usage: node scripts/correct-brief-undated.ts [--apply]");
    console.log("Default is dry-run. --apply updates only the four whitelisted morning rows that are still the old undated error.");
    process.exit(0);
  }
  const unknown = args.filter((arg) => arg !== "--apply");
  if (unknown.length) throw new Error(`unknown argument ${unknown[0]}; this script does not take ids, urls, or a date range`);
  const report = await correctMorningUndated({ apply: args.includes("--apply") });
  console.log(JSON.stringify(report, null, 2));
  await stopBoss();
  await closeDb();
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invoked) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
