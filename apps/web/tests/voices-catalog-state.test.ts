import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mergeVoiceItems,
  knownCatalogTotal,
  voicesCatalogReady,
  voicesSearchOnlyRevalidate,
  voicesMatchCount,
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

test("match count uses rail platform totals while the full catalog is still loading", () => {
  const rail = { 小红书: 179, X: 319, 中文社区: 62 };
  assert.equal(voicesMatchCount({ ready: false, filteredLength: 0, scoped: true, platform: "小红书", railPlatformCounts: rail, railTotal: 560 }), 179);
  assert.equal(voicesMatchCount({ ready: false, filteredLength: 0, scoped: true, platform: "X", railPlatformCounts: rail, railTotal: 560 }), 319);
  assert.equal(voicesMatchCount({ ready: false, filteredLength: 0, scoped: false, platform: "all", railPlatformCounts: rail, railTotal: 560 }), 560);
  assert.equal(voicesMatchCount({ ready: true, filteredLength: 0, scoped: true, platform: "小红书", railPlatformCounts: rail, railTotal: 560 }), 0);
  assert.equal(voicesMatchCount({ ready: true, filteredLength: 179, scoped: true, platform: "小红书", railPlatformCounts: rail, railTotal: 560 }), 179);
});
