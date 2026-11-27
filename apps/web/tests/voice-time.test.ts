import assert from "node:assert/strict";
import { test } from "node:test";
import { formatWhen } from "../app/lib/voice-time.ts";

const today = "2026-11-27";

test("a bare calendar day is the date alone, not 08:00", () => {
  // 微博 vc31a092b532018c2 and X v0fb23d2ca0f863e6: published_at is only a day.
  assert.equal(formatWhen({ day: "2026-11-23", published_at: "2026-11-23" }, today), "11 月 23 日");
  assert.equal(formatWhen({ day: "2026-11-05", published_at: "2026-11-05" }, today), "11 月 5 日");
  assert.equal(formatWhen({ day: null, published_at: "2026-11-23" }, today), "11 月 23 日");
  assert.equal(formatWhen({ day: "2026-11-23", published_at: "2026-11-23" }, today, true), "2026 年 11 月 23 日");
  assert.equal(formatWhen({ day: "2026-11-05", published_at: "2026-11-05" }, today, true), "2026 年 11 月 5 日");
  assert.equal(formatWhen({ day: "2026-11-23", published_at: "2026-11-23T00:00:00.000Z" }, today), "11 月 23 日");
  assert.equal(formatWhen({ day: "2026-11-23", published_at: "2026-11-23T00:00:00+08:00" }, today), "11 月 23 日");
  assert.equal(formatWhen({ day: null, published_at: "2026-11-23T00:00:00.000+08:00" }, today), "11 月 23 日");
});

test("a real Beijing instant still shows the minute", () => {
  assert.equal(formatWhen({ day: "2026-11-24", published_at: "2026-11-24T11:10:52+08:00" }, today), "11 月 24 日 11:10");
  assert.equal(formatWhen({ day: "2026-11-24", published_at: "2026-11-24T11:10:52+08:00" }, today, true), "2026 年 11 月 24 日 11:10");
});

test("a post with no date stays blank", () => {
  assert.equal(formatWhen({ day: null, published_at: null }, today), "");
  assert.equal(formatWhen({ day: null, published_at: "" }, today), "");
});
