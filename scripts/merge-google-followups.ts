// Fold K-12 Dive week-in-review and The 74 "ultimatum" into the Google Nov 3 fact (fact of
// ai-learning-era-updates-2026). The 74 is recorded as a counter-fact, not supporting evidence:
// no relevance bonus. Then republish so the homepage shows one Google card + Khan.
//
//   docker exec -w /app xintian-edu-hot-api-1 node /app/scripts/merge-google-followups.ts
import { closeDb, sql } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { publishArticle } from "@aihot/backend/publication/publish";

const PRIMARY_URL = "https://blog.google/products-and-platforms/products/education/ai-learning-era-updates-2026/";
const THE74_URL = "https://www.the74million.org/article/googles-new-ai-ultimatum-sparks-concern-over-tech-giants-power-in-ca-schools/";
const K12_URL = "https://www.k12dive.com/news/week-in-review-november-9-2026/874038/";

const COUNTER_LABEL = "争议：加州学区被要求二选一";
const COUNTER_EVIDENCE =
  "争议：加州学区被要求二选一。The 74 报道：学区没有不带 AI 的搜索选项，不启用 AI 版搜索就失去 Google 搜索，属于强制捆绑，与「默认关闭、由人开启」相反。这是对同一轮学校管控的争议报道，不能作为心田监护人开启设计的支持证据，不加相关性加分。";
const LEAD_REASON_SUFFIX =
  "另见争议：加州学区被要求二选一——没有「无 AI 搜索」选项，属强制捆绑，与默认关闭、由人开启相反，不作为支持证据。";

const [primary] = await sql<{ id: string; fact_id: number | null }[]>`
  SELECT a.id, p.fact_id FROM articles a LEFT JOIN publications p ON p.article_id = a.id WHERE a.url = ${PRIMARY_URL}`;
if (!primary?.fact_id) {
  console.log(JSON.stringify({ error: "Google primary is not on a fact yet", primary }));
  await stopBoss();
  await closeDb();
  process.exit(1);
}
const factId = primary.fact_id;

const [the74] = await sql<{ id: string }[]>`SELECT id FROM articles WHERE url = ${THE74_URL}`;
const [k12] = await sql<{ id: string }[]>`SELECT id FROM articles WHERE url = ${K12_URL}`;
if (!the74 || !k12) {
  console.log(JSON.stringify({ error: "missing follow-up article", the74, k12 }));
  await stopBoss();
  await closeDb();
  process.exit(1);
}

// Move The 74 off its own fact (fact 10) and attach both follow-ups to the Google fact.
await sql`DELETE FROM fact_articles WHERE article_id = ${the74.id} AND fact_id <> ${factId}`;

await sql`
  INSERT INTO fact_articles (fact_id, article_id, role, evidence, manual)
  VALUES (${factId}, ${the74.id}, ${"report"}, ${COUNTER_EVIDENCE}, ${true})
  ON CONFLICT (fact_id, article_id) DO UPDATE SET role = EXCLUDED.role, evidence = EXCLUDED.evidence, manual = true`;

await sql`
  INSERT INTO fact_articles (fact_id, article_id, role, evidence, manual)
  VALUES (${factId}, ${k12.id}, ${"report"}, ${"同一事件的周报综述：Google 默认关闭 K-12 学生账号的 Gemini 等 AI 功能，须由学校管理员开启。"}, ${true})
  ON CONFLICT (fact_id, article_id) DO UPDATE SET role = EXCLUDED.role, evidence = EXCLUDED.evidence, manual = true`;

// Strip The 74's relevance bonus: keep base score only. Do not re-ask the model.
const [an] = await sql<{
  id: number; score: string | number | null; reason_zh: string | null; output: Record<string, unknown> | null; selected: boolean;
}[]>`SELECT id, score, reason_zh, output, selected FROM analyses WHERE article_id = ${the74.id} ORDER BY id DESC LIMIT 1`;
if (!an) {
  console.log(JSON.stringify({ error: "The 74 has no analysis" }));
  await stopBoss();
  await closeDb();
  process.exit(1);
}
const prev = an.output ?? {};
const base = typeof prev.baseScore === "number" ? prev.baseScore : (an.score != null ? Math.max(0, Number(an.score) - Number(prev.relevanceBonus ?? 8)) : 62);
const output = {
  ...prev,
  baseScore: base,
  relevanceBonus: 0,
  xintianRelevance: "none",
  xintianRelevanceReason: COUNTER_EVIDENCE,
  selected: base >= 60,
};
const reasonZh = COUNTER_EVIDENCE;
await sql`UPDATE analyses SET score = ${base}, selected = ${base >= 60}, reason_zh = ${reasonZh}, output = ${sql.json(output)} WHERE id = ${an.id}`;

// Public title on The 74 card / related-report row: the counter-fact label.
await sql`
  INSERT INTO editorial_overrides (article_id, fields, reason, version, updated_by)
  VALUES (${the74.id}, ${sql.json({ title: COUNTER_LABEL, selected: true })}, ${COUNTER_EVIDENCE}, 1, ${"merge-google-followups"})
  ON CONFLICT (article_id) DO UPDATE SET
    fields = editorial_overrides.fields || ${sql.json({ title: COUNTER_LABEL, selected: true })},
    reason = EXCLUDED.reason,
    version = editorial_overrides.version + 1,
    updated_by = EXCLUDED.updated_by,
    updated_at = now()`;

// Surface the controversy on the lead card's 推荐理由 (homepage visible without expanding reports).
const [leadPub] = await sql<{ reason: string | null }[]>`SELECT reason FROM publications WHERE article_id = ${primary.id}`;
const leadReason = (leadPub?.reason ?? "").trim();
const nextLeadReason = leadReason.includes("争议：加州学区被要求二选一")
  ? leadReason
  : [leadReason, LEAD_REASON_SUFFIX].filter(Boolean).join("");
await sql`
  INSERT INTO editorial_overrides (article_id, fields, reason, version, updated_by)
  VALUES (${primary.id}, ${sql.json({ reason: nextLeadReason })}, ${"homepage records The 74 as a counter-fact, not supporting evidence"}, 1, ${"merge-google-followups"})
  ON CONFLICT (article_id) DO UPDATE SET
    fields = editorial_overrides.fields || ${sql.json({ reason: nextLeadReason })},
    reason = EXCLUDED.reason,
    version = editorial_overrides.version + 1,
    updated_by = EXCLUDED.updated_by,
    updated_at = now()`;

for (const id of [primary.id, the74.id, k12.id]) {
  await publishArticle(id);
}

const after = await sql<{
  id: string; title: string; selected: boolean; fact_id: number | null; score: string | number | null; url: string; reason: string | null;
}[]>`
  SELECT p.article_id AS id, p.title, p.selected, p.fact_id, p.score, a.url, p.reason
  FROM publications p JOIN articles a ON a.id = p.article_id
  WHERE p.fact_id = ${factId} OR a.id IN ${sql([the74.id, k12.id, primary.id])}
  ORDER BY p.score DESC NULLS LAST`;
console.log(JSON.stringify({ factId, the74Base: base, the74Bonus: 0, members: after }, null, 2));

await stopBoss();
await closeDb();
