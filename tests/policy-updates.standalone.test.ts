import assert from "node:assert/strict";
import { test } from "node:test";
import { policyEventKey } from "@aihot/backend/publication/policy-updates";
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
