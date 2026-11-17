// Gives reports analysed before the five dimensions existed their article_facets row: one facets-only
// model call per report (industry/prompts/facets.md), nothing else of the analysis is redone. Idempotent:
// a report that already has a row is skipped, so a rerun only picks up what is still missing.
//
//   node scripts/backfill-facets.ts --dry-run [--limit 5] [--offset 0] [--selected-only]
//     Reads only (the database session is read-only) and prints the plan; with --limit it also asks the
//     model for that many reports and prints the answers. Those calls go straight to the provider,
//     without receipts, so nothing is written anywhere.
//   docker exec -w /app xintian-edu-hot-api-1 node /app/scripts/backfill-facets.ts [--limit N] [--selected-only] [--concurrency 3]
//     Writes: one receipt per call and one article_facets row per report.
import { parseArgs } from "node:util";

const { values: args } = parseArgs({
  options: {
    "dry-run": { type: "boolean", default: false },
    limit: { type: "string" },
    offset: { type: "string", default: "0" },
    "selected-only": { type: "boolean", default: false },
    concurrency: { type: "string", default: "3" },
  },
});
const dryRun = args["dry-run"]!;
const limit = args.limit === undefined ? null : Number(args.limit);
if (limit !== null && (!Number.isInteger(limit) || limit < 0)) throw new Error("--limit takes a whole number");
const offset = Number(args.offset);
if (!Number.isInteger(offset) || offset < 0) throw new Error("--offset takes a whole number");
const concurrency = Math.min(Math.max(Number(args.concurrency) || 1, 1), 8);
// Before the database module loads: every transaction of this process is read-only.
if (dryRun) process.env.DATABASE_READ_ONLY = "true";

const { closeDb, sql } = await import("@aihot/backend/db");
const { loadAnalyzeInput, buildMaterial } = await import("@aihot/backend/editorial/input");
const { FACETS_PROMPT_VERSION, FACETS_SYSTEM, FacetsSchema, runFacets, writeArticleFacets } = await import("@aihot/backend/editorial/facets");
const { modelFor } = await import("@aihot/backend/editorial/models");
const { MODELS } = await import("@aihot/backend/providers/llm");
const { credential } = await import("@aihot/backend/config");
const { parseItemFacets } = await import("@aihot/contracts/facets");

// A dry run may plan against a database the migration has not reached yet: then every report is missing.
const [{ migrated }] = await sql<{ migrated: boolean }[]>`SELECT to_regclass('article_facets') IS NOT NULL AS migrated`;
if (!migrated && !dryRun) throw new Error("article_facets is missing: run the migrations first");

/** Analysed, public reports without a row: 精选 first, newest first. */
const targets = await sql<{ id: string; selected: boolean; title: string }[]>`
  SELECT a.id, p.selected, p.title
  FROM articles a JOIN publications p ON p.article_id = a.id
  WHERE a.processing_state = 'analyzed'
    ${migrated ? sql`AND NOT EXISTS (SELECT 1 FROM article_facets af WHERE af.article_id = a.id)` : sql``}
    ${args["selected-only"] ? sql`AND p.selected` : sql``}
  ORDER BY p.selected DESC, p.sort_at DESC, a.id`;
const chosen = targets.slice(offset, limit === null ? undefined : offset + limit);
const model = await modelFor("structure");
console.log(JSON.stringify({
  mode: dryRun ? "dry-run" : "write", migrated, promptVersion: FACETS_PROMPT_VERSION, model: MODELS[model]?.model || model,
  missing: targets.length, missingSelected: targets.filter((t) => t.selected).length,
  // One call per report; an unusable answer is retried by a rerun, never inside this one.
  estimatedCalls: targets.length, thisRun: chosen.length,
}));

/** The provider call of a dry run: the same prompt, model and parameters as runFacets, without a receipt. */
async function previewFacets(material: string) {
  const spec = MODELS[model]!;
  const baseUrl = credential("models", spec.baseUrlEnv);
  const apiKey = credential("models", spec.apiKeyEnv);
  if (!baseUrl || !apiKey || !spec.model) throw new Error(`model ${model} is not configured`);
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: spec.model,
      messages: [{ role: "system", content: FACETS_SYSTEM }, { role: "user", content: material }],
      temperature: 0.2, max_tokens: 512 + (spec.reasoningTokens ?? 0),
      ...(spec.jsonMode ? { response_format: { type: "json_object" } } : {}), ...(spec.extra ?? {}),
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const body = await res.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: unknown };
  if (!res.ok) throw new Error(`provider answered ${res.status}`);
  const content = body.choices?.[0]?.message?.content ?? "";
  const json = content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1);
  return { raw: JSON.parse(json) as unknown, usage: body.usage ?? null };
}

let done = 0, failed = 0;
const queue = [...chosen];
async function worker() {
  for (let t = queue.shift(); t; t = queue.shift()) {
    try {
      const input = await loadAnalyzeInput(t.id);
      if (!input) continue;
      if (dryRun) {
        const { raw, usage } = await previewFacets(buildMaterial(input));
        console.log(JSON.stringify({ id: t.id, selected: t.selected, title: t.title, facets: parseItemFacets(FacetsSchema.parse(raw)), raw, usage }));
      } else {
        const r = await runFacets(input);
        await writeArticleFacets(sql, { articleId: input.id, revision: input.revision, facets: r.facets, origin: "backfill", model: r.model, promptVersion: FACETS_PROMPT_VERSION });
        console.log(JSON.stringify({ id: t.id, selected: t.selected, facets: r.facets }));
      }
      done++;
    } catch (error) {
      failed++;
      console.error(JSON.stringify({ id: t.id, error: String((error as Error).message ?? error).slice(0, 300) }));
    }
  }
}
await Promise.all(Array.from({ length: concurrency }, worker));
console.log(JSON.stringify({ done, failed, left: targets.length - (dryRun ? 0 : done) }));
await closeDb();
