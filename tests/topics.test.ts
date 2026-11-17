// Topic pages: which articles a topic takes, and their counts.
// Written before the code, from the ways it can go wrong:
// - a company topic takes an article about another company that only mentions it (several subjects,
//   its name nowhere in the title), or drops one about it whose title names it in English, in another
//   case, next to Chinese text, or only by a product (it is the article's only subject);
// - a Latin name matches inside another word ("Metadata" is not Meta); a headline naming a company
//   that is not a subject of the article gets in;
// - a technical-direction topic stops taking its tags;
// - withdrawn or not yet released articles appear in a list or a count;
// - an article or story page names a topic its reports do not belong to;
// - an article page cannot tell which of its tags are a topic's own, so they link to filtered lists;
// - a topic without content has no page, or an unknown slug or a page past the end has one.
import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { publishArticle } from "@aihot/backend/publication/publish";
import { TOPICS, isPublicTopic, loadTopicPage, listTopicSummaries, topicsOfStory } from "@aihot/backend/publication/topics";
import { buildApp } from "../apps/api/src/app.ts";

const T = tag();
const OFFICIAL = `test-topics-official-${T}`;
const MEDIA = `test-topics-media-${T}`;
const app = await buildApp();

before(async () => {
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode, first_party, next_fetch_at) VALUES
    (${OFFICIAL}, 'Official', 'rss', 'T1', 'editorial', true, '2100-01-01'),
    (${MEDIA}, 'Media', 'rss', 'T2', 'editorial', false, '2100-01-01')`;
});
after(async () => {
  await app.close();
  await stopBoss();
  await closeDb();
});

let n = 0;
interface Report {
  source?: string;
  at: Date;
  title: string;
  originalTitle?: string;
  subjects?: string[];
  tags?: string[];
  score?: number;
  selected?: boolean;
  fact?: number;
  category?: string;
}

/** A published report; `fact` links it to a fact before publishing, as grouping would. */
async function report(r: Report): Promise<string> {
  n += 1;
  const { articleId } = await upsertMaterial({
    sourceId: r.source ?? MEDIA, url: `https://example.com/topics-${T}-${n}`, title: r.originalTitle ?? r.title, bodyText: "body", bodyHtml: "<p>body</p>", bodyStatus: "ok", via: "fetch", publishedAt: r.at,
  });
  await sql`UPDATE articles SET discovered_at = ${r.at}, timeline_at = ${r.at}, grouped_at = now() WHERE id = ${articleId}`;
  await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, category, title_zh, summary_zh, score, selected, subjects, tags)
            VALUES (${articleId}, 1, 'rule', 'pass', ${r.category ?? "ai-models"}, ${r.title}, ${`摘要 ${n}`}, ${r.score ?? 80}, ${r.selected ?? true}, ${r.subjects ?? []}, ${[r.category === "ai-products" ? "产品更新" : r.category === "paper" ? "论文/研究" : r.category === "tip" ? "教程/实践" : r.category === "industry" ? "行业动态" : r.category === "opinion" ? "大佬观点" : "模型发布", ...(r.tags ?? [])]})`;
  if (r.fact) await sql`INSERT INTO fact_articles (fact_id, article_id, role) VALUES (${r.fact}, ${articleId}, 'report')`;
  await publishArticle(articleId, { releasedAt: new Date(r.at.getTime() + 60_000) });
  return articleId;
}

async function story(title: string): Promise<{ id: number; publicId: string }> {
  const publicId = randomUUID();
  const [s] = await sql<{ id: number }[]>`INSERT INTO stories (public_id, title, first_report_at, latest_at) VALUES (${publicId}, ${title}, now(), now()) RETURNING id`;
  return { id: s!.id, publicId };
}

async function fact(storyId: number | null, title: string): Promise<number> {
  const [f] = await sql<{ id: number }[]>`INSERT INTO facts (public_id, story_id, title) VALUES (${`f-${T}-${randomUUID()}`}, ${storyId}, ${title}) RETURNING id`;
  return f!.id;
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000);
const ids = (items: Array<{ id: string }>) => items.map((i) => i.id);
const page = async (slug: string, p = 1) => {
  const data = await loadTopicPage(slug, p, new Date());
  assert.ok(data, `${slug} page ${p}`);
  return data;
};
/** Every article of a topic, over all its pages. */
async function members(slug: string): Promise<string[]> {
  const first = await page(slug);
  const out = ids(first.items);
  for (let p = 2; p <= first.pageCount; p++) out.push(...ids((await page(slug, p)).items));
  return out;
}

test("a company topic takes the articles about it, not the ones that only mention it", async () => {
  const about = await report({ at: hoursAgo(30), title: `Gemini 推出学习模式 ${T}`, subjects: ["google"] });
  const product = await report({ at: hoursAgo(31), title: `Guided Learning 新版上线 ${T}`, subjects: ["google"] });
  const english = await report({ at: hoursAgo(32), title: `新学习工具发布 ${T}`, originalTitle: `Google launches a tutor ${T}`, subjects: ["google", "openai"] });
  const subpoena = await report({ at: hoursAgo(33), title: `加州检察长向 OpenAI 发出传票 ${T}`, subjects: ["openai", "google", "microsoft"] });
  const lowerCase = await report({ at: hoursAgo(34), title: `openai 公布新的未成年人保护框架 ${T}`, subjects: ["openai", "google"] });
  const pact = await report({ at: hoursAgo(35), title: `二十余家科技公司签署教育安全协议 ${T}`, subjects: ["openai", "google", "microsoft"] });
  const speaking = await report({ at: hoursAgo(36), title: `Speaking 测评标准发布，OpenAI 参与 ${T}`, subjects: ["speak", "openai"] });
  const adjacent = await report({ at: hoursAgo(37), title: `发布Speak的新口语课 ${T}`, subjects: ["speak", "openai"] });
  const headline = await report({ at: hoursAgo(38), title: `Google 被一篇盘点提到 ${T}`, subjects: ["microsoft"] });
  const tutor = await report({ at: hoursAgo(39), title: `AI 老师功能发布 ${T}`, tags: ["AI老师"] });

  const google = await members("google");
  for (const id of [about, product, english]) assert.ok(google.includes(id), "about Google");
  for (const id of [subpoena, lowerCase, pact, headline]) assert.ok(!google.includes(id), "only mentions Google");
  const openai = await members("openai");
  for (const id of [subpoena, lowerCase, speaking]) assert.ok(openai.includes(id), "about OpenAI");
  for (const id of [english, pact]) assert.ok(!openai.includes(id), "only mentions OpenAI");
  const speak = await members("speak");
  assert.ok(speak.includes(adjacent), "Speak next to Chinese text");
  assert.ok(!speak.includes(speaking), "Speaking is not Speak");
  assert.ok((await members("ai-tutor")).includes(tutor), "a direction takes its tag");

  // The article page names the topics it belongs to.
  const topicsOf = async (id: string) => {
    const res = await app.inject({ method: "GET", url: `/api/site/items/${id}` });
    return (JSON.parse(res.body) as { topics: Array<{ slug: string }> }).topics.map((t) => t.slug);
  };
  assert.deepEqual(await topicsOf(about), ["google", "genre-product"]);
  assert.deepEqual(await topicsOf(subpoena), ["openai", "genre-product"]);
  assert.deepEqual(await topicsOf(pact), ["genre-product"]);
  assert.deepEqual(await topicsOf(tutor), ["ai-tutor", "genre-product"]);
});

test("an article page says which of its tags are a topic's own", async () => {
  // A direction's or a form's tags, and the tag cards show for a company (its subject tag is never shown).
  const id = await report({ at: hoursAgo(3), title: `Google 推出 AI 老师 ${T}`, subjects: ["google", "openai"], tags: ["AI老师", "作文批改", "Google", "OpenAI", "框架"] });
  const res = await app.inject({ method: "GET", url: `/api/site/items/${id}` });
  const body = JSON.parse(res.body) as { tags: string[]; tagTopics: Record<string, string>; topics: Array<{ slug: string }> };
  assert.deepEqual(body.tags, ["模型发布", "AI老师", "作文批改", "Google", "OpenAI", "框架"]);
  assert.deepEqual(body.tagTopics, { "模型发布": "genre-product", AI老师: "ai-tutor", "作文批改": "literacy", Google: "google", OpenAI: "openai" });
  // The company its title does not name is a topic of the tag, not of the article.
  assert.deepEqual(body.topics.map((t) => t.slug), ["google", "literacy", "ai-tutor", "genre-product"]);
});

// This pack renamed no company topic: its full name and each of its names find the subject-tagged reports.
test("a company topic's full name and each of its names find its subject-tagged reports", async () => {
  const id = await report({at: hoursAgo(2), title: `小猿新功能上线 ${T}`, subjects: ['yuanfudao'], selected: false});
  for (const query of ['猿辅导 / 小猿', '猿辅导', '小猿']) {
    const res = await app.inject({method: 'GET', url: `/api/site/pool?q=${encodeURIComponent(query)}`});
    assert.equal(res.statusCode, 200);
    assert.ok(ids(JSON.parse(res.body).items).includes(id), 'full company names must still find subject-tagged reports');
  }
});

test("a story page names the topics of its reports", async () => {
  const launch = await story(`AI 老师 V2 发布 ${T}`);
  await report({ source: OFFICIAL, at: hoursAgo(26), title: `AI 老师 V2 发布 ${T}`, tags: ["AI老师"], fact: await fact(launch.id, "发布 V2") });
  assert.deepEqual(await topicsOfStory(launch.id), [{ slug: "ai-tutor", name: "AI 老师与伴学" }, { slug: "genre-product", name: "产品更新" }]);
});

test("withdrawn articles stay out of lists and counts", async () => {
  const kept = await report({ at: hoursAgo(5), title: `作业帮发布新学习机 ${T}`, subjects: ["zuoyebang"] });
  const withdrawn = await report({ at: hoursAgo(4), title: `作业帮撤回的消息 ${T}`, subjects: ["zuoyebang"] });
  await sql`UPDATE publications SET visibility = 'withdrawn' WHERE article_id = ${withdrawn}`;

  const data = await page("zuoyebang");
  assert.deepEqual(ids(data.items), [kept]);
  assert.equal(data.topic.total, 1);
  const summary = (await listTopicSummaries()).topics.find((t) => t.slug === "zuoyebang")!;
  assert.equal(summary.latest?.title, `作业帮发布新学习机 ${T}`, "the index shows the newest public article");
});

test("every topic has a page; unknown topics and pages past the end have none", async () => {
  const empty = await page("ello");
  assert.equal(empty.topic.indexable, false, "a topic without content is not indexed");
  assert.deepEqual(empty.items, []);
  assert.equal(await loadTopicPage("not-a-topic", 1, new Date()), null);
  assert.equal(await loadTopicPage("ello", 2, new Date()), null);
  const index = await app.inject({ method: "GET", url: "/api/site/topics" });
  const body = JSON.parse(index.body) as { groups: Array<{ key: string }>; topics: Array<{ slug: string }> };
  assert.deepEqual(body.groups.map((g) => g.key), ["company", "field", "genre"]);
  assert.deepEqual(body.topics.map((t) => t.slug).sort(), TOPICS.filter(isPublicTopic).map((t) => t.slug).sort(), "the index lists every public topic");
});
