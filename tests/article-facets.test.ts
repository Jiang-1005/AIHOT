// The five dimensions: processing tags a report with its own facets call after the judgement is
// committed (values outside the lists dropped), and a failing call changes nothing else; the 精选 timeline
// filters by them, each chip's count is the number of cards its filter returns, and a card carries
// exactly the five public fields. Failure cases: a value the model made up reaching readers; the facets
// call deciding or blocking 精选; an older answer replacing a newer revision's; a count that disagrees
// with its result; an internal judgement field leaking into the public card.
import { pointModels, Reply, stub, tag } from "./setup.ts";
import { analysisStep } from "./analysis-steps.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { selectionThreshold, STRUCTURE_SYSTEM } from "@aihot/backend/editorial/analyze";
import { writeArticleFacets } from "@aihot/backend/editorial/facets";
import { processArticle } from "@aihot/backend/jobs/content";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { loadTimeline, queryFeaturedFacetCounts } from "@aihot/backend/publication/timeline";
import { parseItemFacets, type ItemFacets } from "@aihot/contracts/facets";

const T = tag();
const T1 = selectionThreshold({ tier: "T1" })!;
const steps: string[] = [];

const provider = await stub((_hit, req) => {
  const body = JSON.parse(req.body) as { messages: Array<{ content: unknown }> };
  const user = String(body.messages.at(-1)!.content);
  const step = analysisStep(req.body);
  steps.push(step);
  const answer = (content: unknown) => ({ id: `stub-${T}`, model: "stub", choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }], usage: {} });
  if (step === "prefilter") return answer({ label: "PASS", reason: "测试" });
  if (step === "score") return answer({ attentionScore: T1 });
  if (step === "understand") return answer({ itemType: "model_release", authorRole: "principal", tags: [], editorialJudgment: "理由", titleZh: "理解标题", summaryZh: "理解摘要。第二句补充。" });
  if (step === "structure") return answer({ category: "ai-models", tags: ["模型发布"], subjects: [], scope: "single", fact: null });
  if (step === "facets") {
    if (user.includes("FAILS")) return new Reply(400, { error: { message: "request refused", type: "invalid_request_error" } });
    return answer({ topic: "产品与功能", subject: "阅读写作｜推断", form: "编出来的形态", content_type: "官方发布", companies: ["好未来 › 学而思", "X", "网易有道", "skill-file-name"] });
  }
  return answer(`title_zh: 翻译标题\nsummary_zh: 翻译摘要。第二句补充。`);
});
pointModels(provider.url);

after(async () => {
  await provider.close();
  await stopBoss();
  await closeDb();
});

const stored = async (id: string) =>
  (await sql<{ topic: string | null; subject: string | null; form: string | null; content_type: string | null; companies: string[]; origin: string; input_revision: number }[]>`
    SELECT topic, subject, form, content_type, companies, origin, input_revision FROM article_facets WHERE article_id = ${id}`)[0] ?? null;

test("processing tags a report by its own call, and a failing call leaves 精选 as it was", async () => {
  assert.doesNotMatch(STRUCTURE_SYSTEM, /五维|facets/, "the structure step is not asked for the dimensions");
  const source = `facets-analyze-${T}`;
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode, next_fetch_at) VALUES (${source}, ${source}, 'rss', 'T1', 'editorial', '2100-01-01')`;
  const material = async (marker: string) => (await upsertMaterial({
    sourceId: source, url: `https://example.com/${marker}-${T}`, title: `${marker} 学而思发布阅读产品 ${T}`,
    bodyText: `${marker}: ${"好未来旗下学而思发布了一款阅读写作产品，面向小学生。".repeat(6)} (${T})`,
    bodyStatus: "ok", via: "fetch", publishedAt: new Date("2026-11-16T01:02:03Z"),
  } as never)).articleId;
  const judged = async (id: string) => (await sql<{ processing_state: string; selected: boolean }[]>`
    SELECT a.processing_state, p.selected FROM articles a JOIN publications p ON p.article_id = a.id WHERE a.id = ${id}`)[0];

  const tagged = await material("TAGS");
  steps.length = 0;
  assert.equal((await processArticle(tagged)).state, "pass");
  assert.equal(steps.at(-1), "facets", "the facets call comes after the judgement's steps");
  assert.equal(steps.filter((s) => s === "facets").length, 1);
  assert.deepEqual(await stored(tagged), {
    topic: "产品与功能", subject: "阅读写作", form: null, content_type: "官方发布", companies: ["好未来", "学而思", "有道"], origin: "analysis", input_revision: 1,
  });

  const failing = await material("FAILS");
  assert.equal((await processArticle(failing)).state, "pass");
  assert.equal(await stored(failing), null, "the backfill fills it in later");
  assert.deepEqual(await judged(failing), await judged(tagged), "the same judgement and publication with or without facets");
});

test("an older revision's facets never replace a newer one's, and a rerun converges", async () => {
  const source = `facets-rev-${T}`;
  await sql`INSERT INTO sources (id, name, kind, tier) VALUES (${source}, ${source}, 'rss', 'T1')`;
  const id = `${source}-a`;
  await sql`INSERT INTO articles (id, source_id, identity_key, url, title, discovered_at, timeline_at) VALUES (${id}, ${source}, ${id}, ${`https://example.org/${id}`}, ${id}, now(), now())`;
  const row = (revision: number, topic: string) => ({ articleId: id, revision, facets: parseItemFacets({ topic }), origin: "backfill" as const, model: "stub", promptVersion: "facets@test" });
  await writeArticleFacets(sql, row(2, "政策与合规"));
  await writeArticleFacets(sql, row(1, "教学实践"));
  assert.equal((await stored(id))!.topic, "政策与合规");
  await writeArticleFacets(sql, row(2, "政策与合规"));
  assert.equal((await sql`SELECT 1 FROM article_facets WHERE article_id = ${id}`).length, 1);
});

test("the 精选 timeline filters by the five dimensions and every chip count is its result", async () => {
  const prefix = `facets-tl-${T}`;
  const at = new Date("2026-11-16T00:00:00Z");
  const now = new Date(+at + 100_000);
  await sql`INSERT INTO sources (id, name, kind, tier) VALUES (${prefix}, ${prefix}, 'rss', 'T1')`;
  const [fact] = await sql<{ id: number }[]>`INSERT INTO facts (public_id, title) VALUES (${prefix}, ${prefix}) RETURNING id`;
  const add = async (suffix: string, seconds: number, facets: Partial<Record<keyof ItemFacets, unknown>> | null, opts: { fact?: boolean; selected?: boolean } = {}) => {
    const id = `${prefix}-${suffix}`;
    const time = new Date(+at + seconds * 1000);
    // The 精选 slot keeps reports whose dateline is within the last days (scope.ts featuredSlotCondition).
    await sql`INSERT INTO articles (id, source_id, identity_key, url, title, discovered_at, timeline_at, publication_time)
      VALUES (${id}, ${prefix}, ${id}, ${`https://example.org/${id}`}, ${id}, ${time}, ${time}, '2026-11-16')`;
    const [analysis] = await sql<{ id: number }[]>`INSERT INTO analyses (article_id, input_revision, origin, output)
      VALUES (${id}, 1, 'rule', ${sql.json({ focusRelevance: "direct", xintianRelevance: "high" })}) RETURNING id`;
    await sql`INSERT INTO publications (article_id, source_id, analysis_id, title, url, discovered_at, timeline_at, sort_at, visible_after,
      selected, eligible, visibility, channel, tags, fact_id)
      VALUES (${id}, ${prefix}, ${analysis!.id}, ${id}, ${`https://example.org/${id}`}, ${time}, ${time}, ${time}, ${time},
        ${opts.selected ?? true}, true, 'public', 'news', ${[prefix]}, ${opts.fact ? fact!.id : null})`;
    if (opts.fact) await sql`INSERT INTO fact_articles (fact_id, article_id, role) VALUES (${fact!.id}, ${id}, 'report')`;
    if (facets) await writeArticleFacets(sql, { articleId: id, revision: 1, facets: parseItemFacets(facets), origin: "backfill", model: "stub", promptVersion: "facets@test" });
    return id;
  };
  const policy = await add("policy", 10, { topic: "政策与合规", subject: "不涉及", form: "不涉及", content_type: "新闻快讯", companies: [] });
  const product = await add("product", 20, { topic: "产品与功能", subject: "阅读写作", form: "App与网页", content_type: "官方发布", companies: ["好未来 › 学而思"] });
  // Two reports of one fact: one card, counted once under the value both carry.
  await add("fact-a", 30, { topic: "公司与资本", subject: "英语", form: "App与网页", content_type: "新闻快讯", companies: ["Duolingo"] }, { fact: true });
  await add("fact-b", 40, { topic: "公司与资本", subject: "英语", form: "App与网页", content_type: "深度分析", companies: ["多邻国"] }, { fact: true });
  const untagged = await add("untagged", 50, null);
  await add("unselected", 60, { topic: "政策与合规" }, { selected: false });

  const base = { channel: "all" as const, category: null, tag: prefix, now, limit: 40 };
  const keys = async (q: Record<string, string[]>) => (await loadTimeline({ ...base, ...q })).cards.map((c) => c.key);

  assert.deepEqual(await keys({ topic: ["政策与合规"] }), [`a${policy}`]);
  assert.deepEqual(await keys({ company: ["学而思"] }), [`a${product}`], "a brand finds 「公司 › 品牌」");
  assert.deepEqual(await keys({ company: ["多邻国"] }), [`f${fact!.id}`], "aliases name one company");
  assert.deepEqual(await keys({ form: ["App与网页"], content_type: ["官方发布"] }), [`a${product}`], "dimensions combine with AND");
  assert.deepEqual(await keys({ topic: ["政策与合规", "产品与功能"] }), [`a${product}`, `a${policy}`], "values of one dimension combine with OR");
  assert.equal((await keys({})).length, 4, "no filter: the untagged card stays");
  assert.ok(!(await keys({ topic: ["政策与合规"] })).includes(`a${untagged}`));

  const counts = await queryFeaturedFacetCounts(now);
  assert.deepEqual(counts.topic, { 政策与合规: 1, 产品与功能: 1, 公司与资本: 1 });
  assert.equal(counts.company["Duolingo（多邻国）"], 1);
  for (const [dim, values] of Object.entries(counts)) {
    for (const [value, n] of Object.entries(values)) {
      assert.equal((await keys({ [dim]: [value] })).length, n, `${dim}=${value}`);
    }
  }

  const card = (await loadTimeline({ ...base, topic: ["产品与功能"] })).cards[0]!;
  assert.deepEqual(card.item.facets, { topic: "产品与功能", subject: "阅读写作", form: "App与网页", content_type: "官方发布", companies: ["好未来", "学而思"] });
  const untaggedCard = (await loadTimeline(base)).cards.find((c) => c.key === `a${untagged}`)!;
  assert.equal(untaggedCard.item.facets, null);
  assert.doesNotMatch(JSON.stringify(await loadTimeline(base)), /xintian|Relevance/i, "no internal judgement reaches the card");
});
