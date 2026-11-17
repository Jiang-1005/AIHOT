import assert from "node:assert/strict";
import { test } from "node:test";
import { computedAtBeijing, emptyKind, formatHeat, isStale, sourceLine, STALE_AFTER_MS, updatedAtLabel } from "../app/features/hot/presentation.ts";

test("isStale: older than one 13-hour round", () => {
  const now = Date.parse("2026-11-17T12:00:00+08:00");
  assert.equal(isStale("2026-11-17T03:00:00.000Z", now), false); // 13:00 CST same day minus 1h from 12:00? 03:00Z = 11:00 CST, 1h old
  assert.equal(isStale("2026-11-16T23:00:00.000Z", now), false); // 07:00 CST, 5h old
  assert.equal(isStale("2026-11-16T14:59:59.000Z", now), true); // 22:59:59 previous day, just over 13h
  assert.equal(isStale(null, now), true);
  assert.equal(STALE_AFTER_MS, 13 * 60 * 60 * 1000);
});

test("emptyKind distinguishes expired lists from a quiet but fresh window", () => {
  const now = Date.parse("2026-11-17T12:00:00+08:00");
  assert.equal(emptyKind("2026-11-16T14:00:00.000Z", now), "stale");
  assert.equal(emptyKind("2026-11-17T03:00:00.000Z", now), "empty");
});

test("sourceLine: 1 个来源, two or three names, then 等 N 个来源", () => {
  assert.equal(sourceLine(1, []), "1 个来源");
  assert.equal(sourceLine(1, ["芥末堆"]), "芥末堆 · 1 个来源");
  assert.equal(sourceLine(2, ["中新网教育新闻", "芥末堆"]), "中新网教育新闻、芥末堆 · 2 个来源");
  assert.equal(sourceLine(3, ["光明日报", "芥末堆", "中国日报网"]), "光明日报、芥末堆、中国日报网 · 3 个来源");
  assert.equal(sourceLine(5, ["光明日报", "芥末堆", "中国日报网", "中央社"]), "光明日报、芥末堆、中国日报网 等 5 个来源");
});

test("header time carries the Beijing timezone label", () => {
  // 2026-11-17 13:10 CST
  assert.equal(updatedAtLabel("2026-11-17T05:10:00.000Z"), "11月17日 13:10 更新（北京时间）");
  assert.equal(computedAtBeijing("2026-11-14T12:40:18.847Z"), "11月14日 20:40（北京时间）");
});

test("formatHeat keeps small heat readable: 0.4 is not 「0」, integers stay bare", () => {
  assert.equal(formatHeat(0.4), "0.4");
  assert.equal(formatHeat(0.04), "0"); // 0 only when it really is ~0
  assert.equal(formatHeat(0.06), "0.1");
  assert.equal(formatHeat(2), "2");
  assert.equal(formatHeat(12.345), "12.3");
});
