// Public scope at read time. Every query that decides whether a report is public now,
// listed, selected, or evidence of its fact uses these predicates over `publications p` (and, for
// evidence, `fact_articles fa`); no other module spells visibility, the release time or the composite
// rule in SQL, and grouping takes the composite rule from here too. What a publication holds is
// derived once, at publish time, by publish.ts and rules.ts.
import { beijingCalendarDay, SELECTION } from "@aihot/industry/selection";
import { sql } from "../db.ts";
import { independentSelectedSources } from './rules.ts';

/** These reports share their fact's display slot; independent sources keep their own selected card. */
export function foldableSelectionCondition() {
  return sql`(NOT p.selected OR p.source_id <> ALL(${independentSelectedSources()}::text[]))`;
}

/**
 * Only confirmed news enters p.selected (publish.ts). The release timestamp also supports
 * historical imports and ensures every outlet uses the same actual publication time.
 */
export function releasedCondition(now: Date) {
  return sql`(NOT p.selected OR p.visible_after <= ${now})`;
}

/** Listed on public surfaces at `now`: public, pool eligible, and released by then. */
export function listedCondition(now: Date) {
  return sql`p.visibility = 'public' AND p.eligible AND ${releasedCondition(now)}`;
}

/**
 * Browsing 全部动态 on every exit (web list, v1 / MCP / Agent, the all RSS): listed and scoring at least
 * the industry's browse floor; searches reach every listed item. An unscored item (the model declined to score it) stays, as it does in the pool.
 */
export function browsedCondition(now: Date) {
  return sql`${listedCondition(now)} AND (p.score IS NULL OR p.score >= ${SELECTION.browseFloor})`;
}

/** Story reports include older editorial material outside the pool, but never withdrawn or not yet released content. */
export function storyReportCondition(now: Date) {
  return sql`p.visibility = 'public' AND s.participation_mode = 'editorial' AND ${releasedCondition(now)}`;
}

/** Selected set as the website shows it (home timeline, reading groups, topics): every selected report. */
export function selectedCondition(now: Date) {
  return sql`p.visibility = 'public' AND p.selected AND p.visible_after <= ${now}`;
}

/**
 * The selected set as machines receive it (v1, RSS, the sync ledger): the representative of ordinary
 * reports of each fact, plus any independently displayed selected articles (publish.ts settleSeats).
 */
export function seatedCondition(now: Date) {
  return sql`p.visibility = 'public' AND p.selected AND p.seat AND p.visible_after <= ${now}`;
}

/** The report was published from a composite (multi-topic) analysis: it only mentions facts. */
export function compositeCondition() {
  return sql`EXISTS (SELECT 1 FROM analyses evidence_an WHERE evidence_an.id = p.analysis_id AND evidence_an.output->>'scope' = 'composite')`;
}

/**
 * The same rule over the latest analysis of report `article`, for grouping (recall, story roots,
 * consolidation) and for publish.ts when it picks a publication's fact. They decide from the newest
 * analysis, which `p.analysis_id` only points to once the publication is rebuilt from it, and recall
 * also meets reports without a publication. Missing scope is unknown, never composite.
 */
export function latestCompositeCondition(article: ReturnType<typeof sql>) {
  return sql`(SELECT scope_analysis.output->>'scope' = 'composite' FROM analyses scope_analysis
    WHERE scope_analysis.article_id = ${article}
    ORDER BY scope_analysis.input_revision DESC, scope_analysis.id DESC LIMIT 1) IS TRUE`;
}

/**
 * Evidence for a later identity decision: not a composite and not explicitly withdrawn.
 * A summary-only report or one awaiting publication keeps its existing eligibility.
 * Historical memberships and judgements are retained independently of this predicate.
 */
export function groupingEvidenceCondition(article: ReturnType<typeof sql>) {
  return sql`NOT ${latestCompositeCondition(article)} AND NOT EXISTS (
    SELECT 1 FROM publications grouping_publication
    WHERE grouping_publication.article_id = ${article} AND grouping_publication.visibility = 'withdrawn')`;
}

/** `fa` links report `p` to a fact as evidence: a primary or report membership, never a composite. */
export function evidenceCondition() {
  // Manual fact memberships (same-event merges) stay evidence even if the analysis was marked composite.
  return sql`fa.role <> 'mention' AND (fa.manual IS TRUE OR NOT ${compositeCondition()})`;
}

/**
 * Report `p` is still evidence of its own fact (`publications.fact_id`, written at publish time): a
 * membership removed or turned into a mention since then no longer counts.
 */
export function ownFactEvidenceCondition() {
  return sql`EXISTS (SELECT 1 FROM fact_articles fa WHERE fa.fact_id = p.fact_id AND fa.article_id = p.article_id AND ${evidenceCondition()})`;
}

/**
 * The article dateline as a Beijing calendar day (YYYY-MM-DD), matching featuredDatelineDay():
 * URL /YYYY/MM/DD/, then articles.publication_time, then publications.published_at.
 * No discovered_at fallback: an undated item is not in 精选 or 往期.
 */
export function publicationDatelineDaySql() {
  // regexp_match() as a FROM item still yields a row when there is no match (m is null);
  // format() then turns null groups into "--", which is not a date and must not win COALESCE.
  return sql`COALESCE(
    (SELECT format('%s-%s-%s', m[1], m[2], m[3])
       FROM regexp_match(p.url, '/(20[0-9]{2})/(0[1-9]|1[0-2])/(0[1-9]|[12][0-9]|3[01])(?:/|$)') AS m
       WHERE m IS NOT NULL AND m[1] IS NOT NULL AND m[2] IS NOT NULL AND m[3] IS NOT NULL),
    (SELECT CASE
      WHEN a.publication_time ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN left(a.publication_time, 10)
      ELSE NULL
    END FROM articles a WHERE a.id = p.article_id),
    CASE WHEN p.published_at IS NOT NULL THEN to_char(p.published_at AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD') ELSE NULL END
  )`;
}

/** Homepage 精选 (≤ 7 days) or the 往期 view (older than 7, ≤ 30), by dateline age. */
export function featuredSlotCondition(now: Date, slot: "featured" | "archive" = "featured") {
  const today = beijingCalendarDay(now);
  const day = publicationDatelineDaySql();
  if (slot === "archive") {
    return sql`(${day}) IS NOT NULL
      AND (${today}::date - (${day})::date) > ${SELECTION.featuredMaxAgeDays}
      AND (${today}::date - (${day})::date) <= ${SELECTION.archiveMaxAgeDays}`;
  }
  return sql`(${day}) IS NOT NULL
    AND (${today}::date - (${day})::date) <= ${SELECTION.featuredMaxAgeDays}`;
}
