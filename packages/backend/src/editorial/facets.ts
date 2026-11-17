// The five dimensions (topic, subject, form, content_type, companies). New reports get them from the
// structure step, in the same call (analyze.ts); reports analysed before that get them from this
// facets-only prompt (scripts/backfill-facets.ts). Both prompts include industry/prompts/facets-rules.md.
import { z } from "zod";
import { FACET_VOCAB, parseItemFacets, type ItemFacets } from "@aihot/contracts/facets";
import type { Db } from "../db.ts";
import { chatJson } from "../providers/llm.ts";
import { buildMaterial, type AnalyzeInputArticle } from "./input.ts";
import { modelFor } from "./models.ts";
import { promptText, promptVersion } from "./prompts.ts";

const HEAD_COMPANIES_PROMPT = "好未来 › 学而思/九章爱学、新东方、猿辅导 › 小猿/斑马、作业帮、网易有道、科大讯飞、高途、豆神教育、洋葱学园、叫叫、Duolingo、Khan Academy、Chegg、Quizlet、Speak";

/** The values facets-rules.md asks for, wherever it is included. */
export const FACET_PROMPT_VALUES = {
  facetTopics: FACET_VOCAB.topic.join("｜"),
  facetSubjects: FACET_VOCAB.subject.join("｜"),
  facetForms: FACET_VOCAB.form.join("｜"),
  facetContentTypes: FACET_VOCAB.content_type.join("｜"),
  headCompanies: HEAD_COMPANIES_PROMPT,
};

/** The model's facets object, parsed loosely: anything outside the lists becomes null in parseItemFacets. */
export const FacetsSchema = z.record(z.string(), z.unknown()).nullable().catch(null);

export const FACETS_SYSTEM = promptText("facets", FACET_PROMPT_VALUES);
export const FACETS_PROMPT_VERSION = promptVersion("facets");

/** The facets-only call for a report analysed before the structure step produced them. */
export async function runFacets(a: AnalyzeInputArticle): Promise<{ facets: ItemFacets; model: string; receiptId: number; reused: boolean }> {
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
