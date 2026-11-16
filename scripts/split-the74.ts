// The 74 is its own homepage item again (product lead). K-12 Dive stays on the Google fact.
// Title/relevance: 反面案例：不给关闭选项会引发家长和学区反对. Score stays 62+0.
// Markey Nov 9 letter: official URLs were cited but markey.senate.gov returned HTTP 403 here, so no original link.
import { closeDb, sql } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { publishArticle } from "@aihot/backend/publication/publish";

const THE74 = "https://www.the74million.org/article/googles-new-ai-ultimatum-sparks-concern-over-tech-giants-power-in-ca-schools/";
const GOOGLE = "https://blog.google/products-and-platforms/products/education/ai-learning-era-updates-2026/";
const TITLE = "反面案例：不给关闭选项会引发家长和学区反对";
const REASON =
  "反面案例：不给关闭选项会引发家长和学区反对。学区没有不带 AI 的搜索选项，不启用 AI 版搜索就失去 Google 搜索，属于强制捆绑，与「默认关闭、由人开启」相反，不能作为心田设计的支持证据，不加相关性加分。Markey 议员 2026 年 11 月 9 日致 Google 信：未查到原文。";
const LEAD_REASON =
  "Google 把 Guided Learning 从 Gemini 扩展到搜索与 Classroom，并改为学校管理员显式开启，读者可据此判断校园 AI 的准入与引导方式。";

const [the74] = await sql<{ id: string }[]>`SELECT id FROM articles WHERE url = ${THE74}`;
const [google] = await sql<{ id: string }[]>`SELECT id FROM articles WHERE url = ${GOOGLE}`;
if (!the74 || !google) {
  console.log(JSON.stringify({ error: "missing article", the74, google }));
  await stopBoss();
  await closeDb();
  process.exit(1);
}

await sql`DELETE FROM fact_articles WHERE article_id = ${the74.id}`;

const [an] = await sql<{ id: number; output: Record<string, unknown> | null }[]>`
  SELECT id, output FROM analyses WHERE article_id = ${the74.id} ORDER BY id DESC LIMIT 1`;
if (an) {
  const output = {
    ...(an.output ?? {}),
    baseScore: 62,
    relevanceBonus: 0,
    xintianRelevance: "none",
    xintianRelevanceReason: REASON,
    selected: true,
  };
  await sql`UPDATE analyses SET score = 62, selected = true, title_zh = ${TITLE}, reason_zh = ${REASON}, output = ${sql.json(output)} WHERE id = ${an.id}`;
}

await sql`
  INSERT INTO editorial_overrides (article_id, fields, reason, version, updated_by)
  VALUES (${the74.id}, ${sql.json({ title: TITLE, reason: REASON, selected: true })}, ${REASON}, 1, ${"split-the74"})
  ON CONFLICT (article_id) DO UPDATE SET
    fields = editorial_overrides.fields || ${sql.json({ title: TITLE, reason: REASON, selected: true })},
    reason = EXCLUDED.reason,
    version = editorial_overrides.version + 1,
    updated_by = EXCLUDED.updated_by,
    updated_at = now()`;

await sql`
  INSERT INTO editorial_overrides (article_id, fields, reason, version, updated_by)
  VALUES (${google.id}, ${sql.json({ reason: LEAD_REASON })}, ${"The 74 is a standalone card; drop counter-fact from the Google item"}, 1, ${"split-the74"})
  ON CONFLICT (article_id) DO UPDATE SET
    fields = (editorial_overrides.fields - 'reason') || ${sql.json({ reason: LEAD_REASON })},
    reason = EXCLUDED.reason,
    version = editorial_overrides.version + 1,
    updated_by = EXCLUDED.updated_by,
    updated_at = now()`;

await publishArticle(the74.id);
await publishArticle(google.id);

const after = await sql`
  SELECT p.article_id, p.title, p.reason, p.selected, p.fact_id, p.score, a.url
  FROM publications p JOIN articles a ON a.id=p.article_id
  WHERE a.id IN (${the74.id}, ${google.id})`;
console.log(JSON.stringify({ ok: true, after }, null, 2));
await stopBoss();
await closeDb();
