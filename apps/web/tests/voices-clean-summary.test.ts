import assert from "node:assert/strict";
import { test } from "node:test";
import { splitVoiceProvenance } from "../app/features/voices/clean-summary.ts";

test("strips leading crawler provenance sentences and keeps reader content", () => {
  const raw = "原帖 https://x.com/alice/status/123 已打开原帖全文核对通过。多位小学家长反馈豆包爱学的数学分步引导比直接给答案更有帮助。";
  const res = splitVoiceProvenance(raw);
  assert.equal(res.summary, "多位小学家长反馈豆包爱学的数学分步引导比直接给答案更有帮助。");
  assert.ok(res.auditNote?.includes("已打开原帖全文"));
});

test("peels chained verification prefixes cleanly", () => {
  const raw = "核验记录：原文链接正常。已核对原文，一位一线语文教师分享了如何用 AI 做作文批改支架，并避免学生直接套模板。";
  const res = splitVoiceProvenance(raw);
  assert.equal(res.summary, "一位一线语文教师分享了如何用 AI 做作文批改支架，并避免学生直接套模板。");
  assert.equal(res.auditNote, "核验记录：原文链接正常；已核对原文");
});

test("leaves clean reader summaries untouched", () => {
  const raw = "对比了学而思、作业帮和讯飞三款学习机后，最在意的是错题本联动而非花哨功能。";
  assert.deepEqual(splitVoiceProvenance(raw), { summary: raw, auditNote: null });
});

test("falls back to original string if stripping leaves empty text", () => {
  const raw = "原帖页面打不开，未查到原文。";
  assert.deepEqual(splitVoiceProvenance(raw), { summary: raw, auditNote: null });
});
