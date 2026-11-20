import assert from "node:assert/strict";
import { test } from "node:test";
import {
  dedupePolicyItems,
  matchesDomesticPolicyRow,
  policyEventKey,
  type PolicySourceRow,
} from "@aihot/backend/publication/policy-updates";
import { mapCompanyLabel } from "@aihot/backend/publication/company-updates";

test("烟台双减推进会与全国校外培训行政执法经验交流推进会不是同一事件", () => {
  const yantai = "教育部在烟台召开全国深化“双减”推进会暨校外培训规范管理体制改革试点推进会";
  const chongqing = "我市在全国校外培训行政执法经验交流推进会上介绍「双减」治理做法";
  const yantaiUrl = "https://www.sdjyxww.com/html/article_68833.html";
  const chongqingUrl = "https://finance.sina.cn/2026-11-09/detail-iniyears6417148.d.html?vt=4";
  assert.equal(policyEventKey(yantai, yantaiUrl), "shuangjian-yantai");
  assert.equal(policyEventKey(yantai.replace(/“|”/g, '"'), yantaiUrl), "shuangjian-yantai");
  assert.equal(policyEventKey(chongqing, chongqingUrl), chongqingUrl);
  assert.notEqual(policyEventKey(yantai, yantaiUrl), policyEventKey(chongqing, chongqingUrl));
});

test("学为贵、小鹿爱学、凯文教育、一起教育 map to their own roster entries", () => {
  assert.equal(mapCompanyLabel("学为贵")?.id, "xueweigui");
  assert.equal(mapCompanyLabel("学为贵 › 诗词灵境")?.id, "xueweigui");
  assert.equal(mapCompanyLabel("小鹿爱学")?.id, "xiaolu");
  assert.equal(mapCompanyLabel("小鹿愛學")?.id, "xiaolu");
  assert.equal(mapCompanyLabel("银河智学")?.id, "xiaolu");
  assert.equal(mapCompanyLabel("银河智学 › 小鹿爱学")?.id, "xiaolu");
  assert.equal(mapCompanyLabel("北京银河智学教育科技有限公司")?.id, "xiaolu");
  assert.equal(mapCompanyLabel("小鹿爱学")?.name, "银河智学（小鹿爱学）");
  assert.equal(mapCompanyLabel("凯文教育")?.id, "kaiwen");
  assert.equal(mapCompanyLabel("一起教育科技")?.id, "17zuoye");
  assert.equal(mapCompanyLabel("一起作业")?.id, "17zuoye");
});

function policyRow(patch: Partial<PolicySourceRow> = {}): PolicySourceRow {
  return {
    id: "pol-1",
    title: "教育部印发加强中小学人工智能教育通知",
    summary: "明确中小学人工智能课程学时与师资要求。",
    url: "https://www.moe.gov.cn/example/1.html",
    published_at: new Date("2026-11-18T02:00:00Z"),
    publication_time: "2026-11-18",
    source_name: "中国教育在线",
    tags: [],
    verify: "已核对原文",
    body_status: "ok",
    visibility: "public",
    country: "中国",
    section: null,
    type: null,
    brief: null,
    topic: null,
    ...patch,
  };
}

test("non-backfill domestic policy items with policy tag or topic are admitted", () => {
  const window = { since: "2026-08-22", today: "2026-11-20" };
  const byTag = matchesDomesticPolicyRow(policyRow({ id: "tag-1", tags: ["政策/监管"] }), window);
  assert.ok(byTag);
  assert.equal(byTag.fromBackfill, false);

  const byTopic = matchesDomesticPolicyRow(policyRow({ id: "topic-1", topic: "政策与合规", url: "https://www.moe.gov.cn/example/2.html" }), window);
  assert.ok(byTopic);

  const nonPolicy = matchesDomesticPolicyRow(policyRow({ id: "news-1", tags: ["产品更新"], topic: "产品与功能" }), window);
  assert.equal(nonPolicy, null);
});

test("foreign sources are rejected even when tagged as policy", () => {
  const window = { since: "2026-08-22", today: "2026-11-20" };
  assert.equal(
    matchesDomesticPolicyRow(policyRow({ source_name: "EdSurge", country: "US", tags: ["政策/监管"] }), window),
    null,
  );
  assert.equal(
    matchesDomesticPolicyRow(policyRow({ source_name: "EdWeek", country: null, tags: ["政策/监管"] }), window),
    null,
  );
});

test("dedupePolicyItems prefers backfill entries over regular non-backfill entries for the same event", () => {
  const window = { since: "2026-08-22", today: "2026-11-20" };
  const regular = matchesDomesticPolicyRow(
    policyRow({
      id: "reg-yantai",
      title: "教育部在烟台召开全国深化“双减”推进会",
      url: "https://news.example.cn/yantai-1",
      tags: ["政策/监管"],
      section: null,
      brief: null,
    }),
    window,
  )!;
  const backfill = matchesDomesticPolicyRow(
    policyRow({
      id: "bf-yantai",
      title: "教育部在烟台召开全国深化“双减”推进会暨校外培训规范管理体制改革试点推进会",
      url: "https://www.sdjyxww.com/html/article_68833.html",
      section: "policy",
      brief: "policy-backfill",
    }),
    window,
  )!;
  const deduped = dedupePolicyItems([regular, backfill]);
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0]?.id, "bf-yantai");
});
