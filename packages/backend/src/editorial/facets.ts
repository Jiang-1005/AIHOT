// The five dimensions (topic, subject, form, content_type, companies), from their own prompt
// (industry/prompts/facets.md): one call per report after its judgement is committed and published (jobs/content.ts), and
// the same call for reports analysed before (scripts/backfill-facets.ts). It is kept out of the structure
// step on purpose: asked in the same call, the structure's category, tags and subjects moved
// (11 精选 compared, 2026-11-17), and those decide categories, company tags and grouping.
import { z } from "zod";
import { FACET_VOCAB, parseItemFacets, type ItemFacets } from "@aihot/contracts/facets";
import { sql, type Db } from "../db.ts";
import { shutdownSignal } from "../jobs/queue.ts";
import { logError } from "../lib/log-error.ts";
import { chatJson } from "../providers/llm.ts";
import { buildMaterial, loadAnalyzeInput, type AnalyzeInputArticle } from "./input.ts";
import { modelFor } from "./models.ts";
import { promptText, promptVersion } from "./prompts.ts";

const HEAD_COMPANIES_PROMPT = "好未来 › 学而思/九章爱学、新东方、猿辅导 › 小猿/斑马、作业帮、网易有道、科大讯飞、高途、豆神教育、洋葱学园、叫叫、Duolingo、Khan Academy、Chegg、Quizlet、Speak";

/** The values facets-rules.md asks for. */
const FACET_PROMPT_VALUES = {
  facetTopics: FACET_VOCAB.topic.join("｜"),
  facetSubjects: FACET_VOCAB.subject.join("｜"),
  facetForms: FACET_VOCAB.form.join("｜"),
  facetContentTypes: FACET_VOCAB.content_type.join("｜"),
  headCompanies: HEAD_COMPANIES_PROMPT,
};

/** The model's answer, parsed loosely: anything outside the lists becomes null in parseItemFacets. */
export const FacetsSchema = z.record(z.string(), z.unknown()).nullable().catch(null);

export const FACETS_SYSTEM = promptText("facets", FACET_PROMPT_VALUES);
export const FACETS_PROMPT_VERSION = promptVersion("facets");

/** The facets call for one report. */
export async function runFacets(a: AnalyzeInputArticle, attemptTag?: string): Promise<{ facets: ItemFacets; model: string; receiptId: number; reused: boolean }> {
  const model = await modelFor("structure");
  const res = await chatJson({
    model,
    purpose: "facets_article",
    subject: `article:${a.id}@${a.revision}`,
    promptVersion: FACETS_PROMPT_VERSION,
    system: FACETS_SYSTEM,
    user: buildMaterial(a),
    schema: FacetsSchema,
    temperature: 0.2,
    maxTokens: 512,
    attemptTag: attemptTag ? `${attemptTag}:facets` : undefined,
  });
  return { facets: parseItemFacets(res.data), model: res.model, receiptId: res.receiptId, reused: res.reused };
}

/** Upserts one article's five dimensions; a newer revision's row is never replaced by an older one. */
export async function writeArticleFacets(
  db: Db,
  row: { articleId: string; revision: number; facets: ItemFacets; origin: "analysis" | "backfill"; model: string | null; promptVersion: string },
): Promise<void> {
  const f = row.facets;
  await db`
    INSERT INTO article_facets (article_id, input_revision, topic, subject, form, content_type, companies, origin, model, prompt_version)
    VALUES (${row.articleId}, ${row.revision}, ${f.topic}, ${f.subject}, ${f.form}, ${f.content_type}, ${f.companies}::text[], ${row.origin}, ${row.model}, ${row.promptVersion})
    ON CONFLICT (article_id) DO UPDATE SET
      input_revision = EXCLUDED.input_revision, topic = EXCLUDED.topic, subject = EXCLUDED.subject, form = EXCLUDED.form,
      content_type = EXCLUDED.content_type, companies = EXCLUDED.companies, origin = EXCLUDED.origin, model = EXCLUDED.model,
      prompt_version = EXCLUDED.prompt_version, updated_at = now()
    WHERE article_facets.input_revision <= EXCLUDED.input_revision`;
}

/**
 * The facets step of processing, after the judgement is committed and published: tags that revision. A
 * failure (provider, output, a newer revision) only leaves the row missing; scoring and 精选 are already
 * settled, and the backfill fills it in later.
 */
export async function tagArticleFacets(articleId: string, revision: number, attemptTag?: string): Promise<boolean> {
  if (shutdownSignal.signal.aborted) return false;
  try {
    const a = await loadAnalyzeInput(articleId);
    if (!a || a.revision !== revision) return false;
    const r = await runFacets(a, attemptTag);
    await writeArticleFacets(sql, { articleId: a.id, revision: a.revision, facets: r.facets, origin: "analysis", model: r.model, promptVersion: FACETS_PROMPT_VERSION });
    return true;
  } catch (error) {
    console.error(JSON.stringify({ level: "warn", msg: "facets step failed; the report stays untagged until the backfill", articleId, error: logError(error) }));
    return false;
  }
}
