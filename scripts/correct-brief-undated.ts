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
import { RepresentativeBoundaryError, republishTx } from "@aihot/backend/publication/publish";

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
  seat: boolean;
  fact_id: number | null;
};

export interface CorrectionItem {
  id: string;
  url: string;
  action: "would-update" | "updated" | "would-republish" | "republished" | "unchanged" | "skipped" | "refused";
  reason: string;
  dates: { originalDay: string | null; discoveredAt: string | null; importDay: string | null };
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  publicationBefore: { published_at: string | null; timeline_at: string; backfill: boolean; score: number | null; eligible: boolean; selected: boolean; seat: boolean; fact_id: number | null } | null;
  publicationAfter: { published_at: string | null; timeline_at: string; backfill: boolean; score: number | null; eligible: boolean; selected: boolean; seat: boolean; fact_id: number | null } | null;
}

export interface CorrectionReport {
  mode: "dry-run" | "apply";
  whitelist: Array<{ id: string; url: string }>;
  excludedIds: readonly string[];
  boundary: typeof CORRECTION_BOUNDARY;
  items: CorrectionItem[];
  recovery: string;
}

const RECOVERY = "Restore only from each item's before snapshot: the article date columns, that article's publication columns, and its own selected_ledger/selected_state rows. Do not copy discovered_at or the import day into published_at. This script does not restore and does not change scores.";

/**
 * Normal publish (republishTx) also reseats every other report of the same fact and can enqueue
 * notifySelected and prepareMedia. This correction does not do those. It writes the whitelist
 * article, that article's publication and pool_search row, and that article's own
 * selected_ledger/selected_state when it is the sole representative. If keeping the current seat
 * would create a second ordinary representative, or would select the article and leave it out of
 * the ledger, the item is refused and nothing is written. Peer seats stay as they were.
 */
export const CORRECTION_BOUNDARY = {
  republish: "bounded: own publication and own ledger only; a same-fact representative conflict is refused before any write",
  notifySelected: "not enqueued; a later ordinary republish does not enqueue either, because selected is already true",
  prepareMedia: "not enqueued",
  otherPublications: "not updated; a conflicting peer is left untouched because the correction is refused",
  selectedLedger: "own article only, and only when that article is the sole representative; otherwise the item is refused",
  productionFacts: "not read and not written; a local snapshot is an isolated fixture, not a live query",
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
    seat: row.seat,
    fact_id: row.fact_id,
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

async function writeCorrectedArticle(
  tx: Tx,
  entry: { id: string; url: string },
  decision: TimelineDecision,
  evidence: string,
): Promise<number> {
  const updated = await tx<{ id: string }[]>`
    UPDATE articles SET
      published_at = ${decision.publishedAt},
      published_at_claim = ${decision.publishedAt},
      publication_time = ${evidence},
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
  return updated.length;
}

/** Applies the date change and bounded republish, then rolls them back. Returns a refusal, or null when the write would be in bounds. */
async function probeBounded(
  tx: Tx,
  entry: { id: string; url: string },
  decision: TimelineDecision,
  evidence: string,
  writeDates: boolean,
): Promise<string | null> {
  await tx`SAVEPOINT brief_boundary`;
  try {
    if (writeDates) {
      const updated = await writeCorrectedArticle(tx, entry, decision, evidence);
      if (updated !== 1) throw new Error(`refused to update ${entry.id}: it no longer matches the old undated error`);
    }
    await republishTx(tx, entry.id, { bounded: true });
    await tx`ROLLBACK TO SAVEPOINT brief_boundary`;
    await tx`RELEASE SAVEPOINT brief_boundary`;
    return null;
  } catch (err) {
    await tx`ROLLBACK TO SAVEPOINT brief_boundary`;
    await tx`RELEASE SAVEPOINT brief_boundary`;
    if (err instanceof RepresentativeBoundaryError) return err.message;
    throw err;
  }
}

const ARTICLE_COLUMNS = sql`id, url, published_at, published_at_claim, publication_time, discovered_at, timeline_at, backfill, backfill_reason, updated_at`;

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
      SELECT article_id, published_at, timeline_at, backfill, score, eligible, selected, seat, fact_id
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
        const refusal = await probeBounded(tx, entry, decision, parsed.evidence, false);
        if (refusal) {
          if (options.apply) throw new Error(refusal);
          items.push(item(entry, "refused", refusal, dates, before, before, publication, publication));
          continue;
        }
        if (options.apply) await republishTx(tx, entry.id, { bounded: true });
        items.push(item(
          entry,
          options.apply ? "republished" : "would-republish",
          "article already has the original day; own publication and own ledger projected, no peer or notification",
          dates, before, before, publication, options.apply ? null : publication,
        ));
        continue;
      }
      if (!isOldUndated(article, entry.url)) {
        items.push({ ...skipped(entry, "not the old undated error", before, publication), dates });
        continue;
      }
      const refusal = await probeBounded(tx, entry, decision, parsed.evidence, true);
      if (refusal) {
        if (options.apply) throw new Error(refusal);
        items.push(item(entry, "refused", refusal, dates, before, before, publication, publication));
        continue;
      }
      if (options.apply) {
        const updated = await writeCorrectedArticle(tx, entry, decision, parsed.evidence);
        if (updated !== 1) throw new Error(`refused to update ${entry.id}: it no longer matches the old undated error`);
        await republishTx(tx, entry.id, { bounded: true });
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
        SELECT article_id, published_at, timeline_at, backfill, score, eligible, selected, seat, fact_id
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
