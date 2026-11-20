import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mergeVoiceItems,
  knownCatalogTotal,
  voicesCatalogReady,
  voicesSearchOnlyRevalidate,
  voicesMatchCount,
  inVoicesHotWindow,
  voicesHotWindowEmpty,
  voicesClearFiltersLabel,
} from "../app/features/voices/catalog-state.ts";

test("mergeVoiceItems never replaces a longer catalog with a shorter or empty payload", () => {
  const full = Array.from({ length: 560 }, (_, i) => ({ id: String(i) }));
  const preview = full.slice(0, 12);
  const empty: typeof full = [];
  assert.equal(mergeVoiceItems(preview, full).length, 560);
  assert.equal(mergeVoiceItems(full, preview).length, 560);
  assert.equal(mergeVoiceItems(full, empty).length, 560);
  assert.equal(mergeVoiceItems([], preview).length, 12);
  assert.equal(mergeVoiceItems(preview, preview).length, 12);
});

test("knownCatalogTotal keeps the highest total and ignores a later empty catalog's 0", () => {
  assert.equal(knownCatalogTotal(560, 0, 12, undefined), 560);
  assert.equal(knownCatalogTotal(undefined, 0), 0);
  assert.equal(knownCatalogTotal(179, 560, 62), 560);
});

test("voicesCatalogReady is false for a preview or an empty cold catalog", () => {
  assert.equal(voicesCatalogReady(12, 560), false);
  assert.equal(voicesCatalogReady(0, 0), false);
  assert.equal(voicesCatalogReady(560, 560), true);
  assert.equal(voicesCatalogReady(560, 179), true);
});

test("search-only changes on the same path must not revalidate the loader", () => {
  assert.equal(voicesSearchOnlyRevalidate("/voices", "/voices", "", "?platform=%E5%B0%8F%E7%BA%A2%E4%B9%A6", true), false);
  assert.equal(voicesSearchOnlyRevalidate("/voices", "/voices", "?platform=X", "?platform=%E5%B0%8F%E7%BA%A2%E4%B9%A6", true), false);
  assert.equal(voicesSearchOnlyRevalidate("/", "/voices", "", "", true), true);
  assert.equal(voicesSearchOnlyRevalidate("/voices", "/", "?platform=X", "", true), true);
  assert.equal(voicesSearchOnlyRevalidate("/voices", "/voices", "", "", true), true);
  assert.equal(voicesSearchOnlyRevalidate("/voices", "/voices", "", "", false), false);
});

test("the 7-day hot window keeps day 7 and leaves an unknown age outside", () => {
  assert.equal(inVoicesHotWindow(0), true);
  assert.equal(inVoicesHotWindow(7), true);
  assert.equal(inVoicesHotWindow(8), false);
  assert.equal(inVoicesHotWindow(11), false);
  assert.equal(inVoicesHotWindow(null), false);
  assert.equal(inVoicesHotWindow(undefined), false);
});

test("an empty 7-day platform list names that platform and counts the same filters over all time", () => {
  const xhs = voicesHotWindowEmpty({ sort: "hot", platform: "小红书", narrowed: false, windowCount: 0, allTimeCount: 179 });
  assert.deepEqual(xhs, { title: "近7天无小红书帖子", count: 179, action: "查看全部时间179条" });
  const x = voicesHotWindowEmpty({ sort: "hot", platform: "X", narrowed: false, windowCount: 0, allTimeCount: 12 });
  assert.equal(x?.title, "近7天无X帖子");
  assert.equal(x?.action, "查看全部时间12条");
  const cn = voicesHotWindowEmpty({ sort: "hot", platform: "中文社区", narrowed: false, windowCount: 0, allTimeCount: 40 });
  assert.equal(cn?.title, "近7天无中文社区帖子");
  assert.equal(cn?.count, 40);
  const douban = voicesHotWindowEmpty({ sort: "hot", platform: "豆瓣", narrowed: false, windowCount: 0, allTimeCount: 1 });
  assert.equal(douban?.action, "查看全部时间1条");
});

test("extra filters stay in the all-time count and the title does not blame the platform alone", () => {
  const narrowed = voicesHotWindowEmpty({ sort: "hot", platform: "小红书", narrowed: true, windowCount: 0, allTimeCount: 6 });
  assert.equal(narrowed?.title, "近7天无符合筛选的小红书帖子");
  assert.equal(narrowed?.action, "查看全部时间6条");
  const filtersOnly = voicesHotWindowEmpty({ sort: "hot", platform: "all", narrowed: true, windowCount: 0, allTimeCount: 4 });
  assert.equal(filtersOnly?.title, "近7天无符合筛选的帖子");
  assert.equal(filtersOnly?.count, 4);
  const bare = voicesHotWindowEmpty({ sort: "hot", platform: "all", narrowed: false, windowCount: 0, allTimeCount: 20 });
  assert.equal(bare?.title, "近7天无帖子");
});

test("the all-time escape stays hidden when the 7-day list has posts, all time is also empty, or sort is already latest", () => {
  assert.equal(voicesHotWindowEmpty({ sort: "hot", platform: "X", narrowed: false, windowCount: 168, allTimeCount: 361 }), null);
  assert.equal(voicesHotWindowEmpty({ sort: "hot", platform: "小红书", narrowed: false, windowCount: 0, allTimeCount: 0 }), null);
  assert.equal(voicesHotWindowEmpty({ sort: "latest", platform: "小红书", narrowed: false, windowCount: 179, allTimeCount: 179 }), null);
});

test("clearing filters keeps the 7-day sort and the label says so", () => {
  assert.equal(voicesClearFiltersLabel("hot"), "清空筛选，仍看近 7 天");
  assert.equal(voicesClearFiltersLabel("latest"), "清空筛选");
});

test("match count uses rail platform totals while the full catalog is still loading", () => {
  const rail = { 小红书: 179, X: 319, 中文社区: 62 };
  assert.equal(voicesMatchCount({ ready: false, filteredLength: 0, scoped: true, platform: "小红书", railPlatformCounts: rail, railTotal: 560 }), 179);
  assert.equal(voicesMatchCount({ ready: false, filteredLength: 0, scoped: true, platform: "X", railPlatformCounts: rail, railTotal: 560 }), 319);
  assert.equal(voicesMatchCount({ ready: false, filteredLength: 0, scoped: false, platform: "all", railPlatformCounts: rail, railTotal: 560 }), 560);
  assert.equal(voicesMatchCount({ ready: true, filteredLength: 0, scoped: true, platform: "小红书", railPlatformCounts: rail, railTotal: 560 }), 0);
  assert.equal(voicesMatchCount({ ready: true, filteredLength: 179, scoped: true, platform: "小红书", railPlatformCounts: rail, railTotal: 560 }), 179);
});
