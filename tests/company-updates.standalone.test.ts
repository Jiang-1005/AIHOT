import assert from "node:assert/strict";
import { test } from "node:test";
import {
  COMPANY_ROSTER,
  COMPANY_EVENT_TITLE_SIMILARITY,
  dedupeCompanyEvents,
  flattenCompanyTimeline,
  isCommunityVoiceItem,
  mapCompanyLabel,
  normalizeCompanyUrl,
  scrubPublic,
  sortCompaniesByLatest,
  titleSimilarity,
  type CompanyUpdateSection,
} from "@aihot/backend/publication/company-updates";

test("心田花开 and 花啦啦 map to the 心田花开 company like any other roster entry", () => {
  const label = mapCompanyLabel("心田花开");
  const alias = mapCompanyLabel("花啦啦");
  const nested = mapCompanyLabel("心田花开 › 花啦啦");
  assert.equal(label?.id, "huakai");
  assert.equal(label?.name, "心田花开");
  assert.equal(alias?.id, "huakai");
  assert.equal(nested?.id, "huakai");
  assert.equal(mapCompanyLabel("新东方")?.id, "xdf");
  const index = COMPANY_ROSTER.findIndex((c) => c.id === "huakai");
  assert.ok(index > 0, "心田花开 must not be the first tab");
  assert.ok(index < COMPANY_ROSTER.length);
});

test("scrubPublic keeps company names and tidies whitespace", () => {
  assert.equal(scrubPublic("心田花开推出花啦啦新课"), "心田花开推出花啦啦新课");
  assert.equal(scrubPublic("  作业帮   发布新品  "), "作业帮 发布新品");
});

test("X posts stay out of /companies even when tagged 心田花开 › 花啦啦", () => {
  assert.equal(isCommunityVoiceItem({ url: "https://x.com/edu/status/1", hasXPost: true }), true);
  assert.equal(isCommunityVoiceItem({ url: "https://www.xiaohongshu.com/explore/1", sourceKind: "xhs" }), true);
  assert.equal(isCommunityVoiceItem({ url: "https://www.rmzxw.com.cn/c/2026-11-10/4004398.shtml" }), false);
});

test("按公司 chips are ordered by each company's latest update, empties last", () => {
  const companies = [
    { id: "a", name: "作业帮", items: [{ date: "2026-10-01" }], empty: false, previewMax: 5, latest: "2026-10-01" },
    { id: "b", name: "新东方", items: [{ date: "2026-11-07" }, { date: "2026-10-02" }], empty: false, previewMax: 5, latest: "2026-11-07" },
    { id: "c", name: "心田花开", items: [], empty: true, previewMax: 5, latest: null },
  ] as CompanyUpdateSection[];
  const ordered = sortCompaniesByLatest(companies);
  assert.deepEqual(ordered.map((c) => c.name), ["新东方", "作业帮", "心田花开"]);
});

test("按时间 flattens companies newest-first and keeps multi-company items once", () => {
  const shared = { id: "same", title: "一周连连看", url: "https://example.com/a", date: "2026-11-01", source: "多家", unverified: false, multiCompany: true, companies: [{ id: "xdf", name: "新东方" }, { id: "xueersi", name: "学而思/好未来" }] };
  const companies = [
    { id: "xdf", name: "新东方", items: [shared, { id: "b", title: "B", url: "https://example.com/b", date: "2026-11-08", source: "报", unverified: false, companies: [{ id: "xdf", name: "新东方" }] }], empty: false, previewMax: 5, latest: "2026-11-08" },
    { id: "xueersi", name: "学而思/好未来", items: [shared], empty: false, previewMax: 5, latest: "2026-11-01" },
  ] as CompanyUpdateSection[];
  const timeline = flattenCompanyTimeline(companies);
  assert.deepEqual(timeline.map((i) => i.id), ["b", "same"]);
  assert.equal(timeline.length, 2);
});

test("same eastmoney article with tracking query is one event and keeps the fuller summary", () => {
  const short = {
    id: "q89g38m7ahoasg7og7w27nle3",
    title: "科大讯飞AI学习机牵头制定国内首个「精准学」团标",
    url: "https://caifuhao.eastmoney.com/news/20261109102457176418250?from=guba&name=56eR5aSn6K6v6aOe5ZCn",
    date: "2026-11-09",
    source: "东方财富财富号",
    unverified: false,
    summary: "讯飞学习机团队作为主要起草单位之一的《AI学习机精准学系统技术要求》团体标准（T/WEA 364—2026）发布，由中国智慧工程研究会提出并归口；「国内首个」为讯飞方说法。",
  };
  const full = {
    id: "akuri5le99li3maq1h5e2tdq0",
    title: "科大讯飞参与起草的《AI学习机精准学系统技术要求》团体标准发布",
    url: "https://caifuhao.eastmoney.com/news/20261109102457176418250",
    date: "2026-11-09",
    source: "东方财富财富号",
    unverified: false,
    summary: "科大讯飞2026-11-09在东方财富财富号发文称，由科大讯飞AI学习机团队作为主要起草单位之一、联合多家教育与科技企业共同起草的《AI学习机精准学系统技术要求》团体标准（T/WEA 364—2026）正式发布，由中国智慧工程研究会提出并归口，文中称这是国内首个针对AI学习机精准学场景的专项技术标准。文中摘录的标准要求包括：知识图谱对教材和考试考点覆盖度不低于95%；错因诊断至少区分计算失误、概念混淆、思路偏差、审题错误、知识遗忘中的四种；知识点掌握度预测准确率不低于90%；学习诊断响应时间不超过2秒；默认单次最长使用时长宜不超过40分钟，达时强制休息。上述指标来自该官方发文对标准文本的转述。",
  };
  assert.equal(normalizeCompanyUrl(short.url), normalizeCompanyUrl(full.url));
  assert.ok(titleSimilarity(short.title, full.title) < COMPANY_EVENT_TITLE_SIMILARITY, "titles stay below the general similarity bar; this pair is merged by canonical URL only");
  for (const order of [[short, full], [full, short]]) {
    const kept = dedupeCompanyEvents(order);
    assert.equal(kept.length, 1);
    assert.equal(kept[0]?.id, full.id);
    assert.match(kept[0]?.summary ?? "", /知识图谱/);
  }
});

test("canonical URL merge does not join different articles on the same day", () => {
  const a = {
    id: "a",
    title: "重庆在全国校外培训行政执法经验交流推进会上介绍双减治理做法",
    url: "https://example.com/chongqing-shuangjian",
    date: "2026-11-09",
    source: "重庆日报",
    unverified: false,
    summary: "重庆交流。",
  };
  const b = {
    id: "b",
    title: "教育部在烟台召开全国深化双减推进会暨校外培训规范管理体制改革试点推进会",
    url: "https://example.com/yantai-shuangjian",
    date: "2026-10-19",
    source: "烟台日报",
    unverified: false,
    summary: "烟台推进会。",
  };
  const kept = dedupeCompanyEvents([a, b]);
  assert.equal(kept.length, 2);
});

test("银河智学 and 小鹿爱学 map to one roster entry with the combined display name", () => {
  const label = mapCompanyLabel("小鹿爱学");
  assert.equal(label?.id, "xiaolu");
  assert.equal(label?.name, "银河智学（小鹿爱学）");
  assert.equal(mapCompanyLabel("银河智学")?.id, "xiaolu");
  assert.equal(mapCompanyLabel("银河智学 › 小鹿爱学")?.id, "xiaolu");
  assert.equal(mapCompanyLabel("北京银河智学教育科技有限公司")?.id, "xiaolu");
  assert.equal(mapCompanyLabel("银河智学")?.name, "银河智学（小鹿爱学）");
  const names = COMPANY_ROSTER.filter((c) => /小鹿爱学|银河智学/.test(`${c.name} ${c.aliases.join(" ")}`)).map((c) => c.id);
  assert.deepEqual(names, ["xiaolu"]);
});
