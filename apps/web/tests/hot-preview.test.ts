import assert from "node:assert/strict";
import { test } from "node:test";
import type { HotResponse } from "@aihot/contracts/site";
import { applyDemoState, demoState, previewEnabled } from "../app/features/hot/preview.ts";
import { sourceLineParts } from "../app/features/hot/presentation.ts";

const REAL: HotResponse = {
  computedAt: "2026-11-17T06:28:11.334Z",
  windowHours: 48,
  entries: [{ rank: 1, story: { publicId: "6c2ef478-dac2-4a16-9918-6819fb76200b", title: "t" } } as HotResponse["entries"][number]],
};

test("without a demo state the page shows the api answer untouched", () => {
  assert.equal(applyDemoState(REAL, null), REAL);
  assert.equal(demoState(null), null);
  assert.equal(demoState("fixture"), null, "no fixture list any more");
});

test("demo states: empty and stale-empty are empty; stale keeps the real entries 14 hours older", () => {
  const now = Date.parse("2026-11-17T14:30:00+08:00");
  assert.deepEqual(applyDemoState(REAL, "empty", now).entries, []);
  assert.deepEqual(applyDemoState(REAL, "stale-empty", now).entries, []);
  const stale = applyDemoState(REAL, "stale", now);
  assert.equal(stale.entries, REAL.entries);
  assert.equal(stale.computedAt, new Date(now - 14 * 3_600_000).toISOString());
});

test("demo states only on previews", () => {
  assert.equal(previewEnabled({ VERCEL_ENV: "production" }), false);
  assert.equal(previewEnabled({ VERCEL_ENV: "preview" }), true);
});

test("source count is split off so it can stay on one line", () => {
  assert.deepEqual(sourceLineParts(1, ["北京师范大学未来教育高精尖创新中心"]), ["北京师范大学未来教育高精尖创新中心", " · 1 个来源"]);
  assert.deepEqual(sourceLineParts(5, ["a", "b", "c", "d"]), ["a、b、c", " 等 5 个来源"]);
  assert.deepEqual(sourceLineParts(1, []), ["", "1 个来源"]);
});
