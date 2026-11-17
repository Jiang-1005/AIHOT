import assert from "node:assert/strict";
import { test } from "node:test";
import { sourcesOf } from "@aihot/backend/publication/story-sources";

const at = (iso: string) => new Date(iso);

test("sourcesOf: one row per source, each carrying its report's original URL", () => {
  const rows = sourcesOf([
    { id: "a1", url: "https://www.jiemodui.com/N/1.html", selected: false, at: at("2026-11-10T07:26:22Z"), source_id: "s1", source_name: "芥末堆" },
    { id: "a2", url: "https://www.chinanews.com.cn/edu/1.shtml", selected: true, at: at("2026-11-10T09:22:49Z"), source_id: "s2", source_name: "中新网教育新闻" },
    { id: "a3", url: "https://www.jiemodui.com/N/2.html", selected: false, at: at("2026-11-09T07:00:00Z"), source_id: "s1", source_name: "芥末堆" },
  ]);
  assert.deepEqual(rows.map((r) => [r.name, r.itemId, r.url]), [
    ["中新网教育新闻", "a2", "https://www.chinanews.com.cn/edu/1.shtml"],
    ["芥末堆", "a1", "https://www.jiemodui.com/N/1.html"],
  ]);
});

test("sourcesOf: a report with a URL wins over a newer one without; none at all gives null", () => {
  const rows = sourcesOf([
    { id: "b1", url: "", selected: true, at: at("2026-11-10T09:00:00Z"), source_id: "s1", source_name: "光明日报" },
    { id: "b2", url: "https://news.gmw.cn/1.htm", selected: false, at: at("2026-11-09T09:00:00Z"), source_id: "s1", source_name: "光明日报" },
    { id: "b3", url: "not a url", selected: false, at: at("2026-11-08T09:00:00Z"), source_id: "s2", source_name: "中国日报网" },
  ]);
  assert.deepEqual(rows.map((r) => [r.itemId, r.url]), [["b2", "https://news.gmw.cn/1.htm"], ["b3", null]]);
});
