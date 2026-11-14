// Merge the three Google 2026-11-03 Guided Learning / Classroom posts into one fact
// so the timeline shows one card with related reports attached.
//   docker exec -w /app xintian-edu-hot-api-1 node /app/scripts/merge-google-nov3.ts
import { closeDb, sql } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { newShortId, newUuid } from "@aihot/backend/lib/ids";
import { publishArticle } from "@aihot/backend/publication/publish";

const URLS = [
  "https://blog.google/products-and-platforms/products/education/guided-learning-uk-japan/",
  "https://blog.google/products-and-platforms/products/education/ai-learning-era-updates-2026/",
  "https://blog.google/products-and-platforms/products/education/ai-learning-era-2026/",
];

const articles = await sql<{ id: string; title: string; published_at: Date | null }[]>`
  SELECT a.id, coalesce(p.title, a.title) AS title, a.published_at
  FROM articles a
  LEFT JOIN publications p ON p.article_id = a.id
  WHERE a.url = ANY(${URLS})
`;
if (articles.length < 2) {
  console.log(JSON.stringify({ error: "expected at least 2 Google Nov 3 posts", found: articles }));
  await stopBoss();
  await closeDb();
  process.exit(1);
}

const existing = await sql<{ fact_id: number }[]>`
  SELECT DISTINCT fa.fact_id
  FROM fact_articles fa
  WHERE fa.article_id IN ${sql(articles.map((a) => a.id))}
`;

const at = articles.map((a) => a.published_at).filter((d): d is Date => !!d).sort((a, b) => +a - +b)[0] ?? new Date();
const title = "Google 发布 Guided Learning 研究，并在 Search 与 Classroom 全球上线（含学校管理默认关闭）";

let factId = existing[0]?.fact_id ?? null;
if (factId == null) {
  const [story] = await sql<{ id: number }[]>`
    INSERT INTO stories (public_id, title, first_report_at, latest_at, origin)
    VALUES (${newUuid()}, ${title}, ${at}, ${at}, 'manual')
    RETURNING id`;
  const [fact] = await sql<{ id: number }[]>`
    INSERT INTO facts (public_id, story_id, title, subject, action, object, occurred_at, manual, created_at)
    VALUES (${`f${newShortId(8)}`}, ${story!.id}, ${title}, ${"Google"}, ${"发布 Guided Learning 并调整学校 AI 控制"}, ${"Search 与 Google Classroom"}, ${at}, ${true}, ${at})
    RETURNING id`;
  factId = fact!.id;
} else {
  await sql`UPDATE facts SET manual = true, title = ${title}, updated_at = now() WHERE id = ${factId}`;
}

const roles: Record<string, "primary" | "report"> = {
  "https://blog.google/products-and-platforms/products/education/ai-learning-era-updates-2026/": "primary",
};
for (const a of articles) {
  const url = (await sql<{ url: string }[]>`SELECT url FROM articles WHERE id = ${a.id}`)[0]!.url;
  const role = roles[url] ?? "report";
  await sql`
    INSERT INTO fact_articles (fact_id, article_id, role, evidence, manual)
    VALUES (${factId}, ${a.id}, ${role}, ${"同一事件的官方说明：Guided Learning 研究、Classroom/Search 上线与学校默认关闭控制。"}, ${true})
    ON CONFLICT (fact_id, article_id) DO UPDATE SET role = EXCLUDED.role, evidence = EXCLUDED.evidence, manual = true`;
}

// The school-controls post was previously marked selection_adds_value=false
// (treated as a duplicate). It is the lead card after this merge, so it must
// be allowed onto the public 精选/往期 surface; the other two stay as related reports.
const primaryUrl = "https://blog.google/products-and-platforms/products/education/ai-learning-era-updates-2026/";
const primary = (await sql<{ id: string }[]>`SELECT id FROM articles WHERE url = ${primaryUrl}`)[0];
if (primary) {
  await sql`UPDATE articles SET selection_adds_value = true WHERE id = ${primary.id}`;
}

for (const a of articles) {
  await publishArticle(a.id);
}

const after = await sql<{ id: string; title: string; selected: boolean; fact_id: number | null; url: string }[]>`
  SELECT p.article_id AS id, p.title, p.selected, p.fact_id, p.url
  FROM publications p WHERE p.article_id IN ${sql(articles.map((a) => a.id))}
  ORDER BY p.selected DESC, p.score DESC NULLS LAST`;
console.log(JSON.stringify({ factId, members: after }, null, 2));

await stopBoss();
await closeDb();
