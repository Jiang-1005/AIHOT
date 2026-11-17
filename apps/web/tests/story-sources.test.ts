import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { MISSING_URL_LABEL, SourceList, sourceRows } from "../app/features/story/sources.ts";

const TWO_SOURCES = {
  timeline: [],
  sources: [
    { name: "中新网教育新闻", itemId: "11111111-1111-4111-8111-111111111111", publishedAt: "2026-11-10T09:22:49.000Z", url: "https://www.chinanews.com.cn/edu/2026/11-10/1.shtml" },
    { name: "芥末堆", itemId: "22222222-2222-4222-8222-222222222222", publishedAt: "2026-11-10T07:26:22.000Z", url: "https://www.jiemodui.com/N/1.html" },
  ],
};

function render(story: Parameters<typeof sourceRows>[0]): string {
  return renderToStaticMarkup(h(MemoryRouter, null, h(SourceList, { rows: sourceRows(story) })));
}

function rowsOf(html: string): string[] {
  return html.split("<li").slice(1);
}

test("every source row on the event page has its media name and an external original link (new tab, noopener)", () => {
  const html = render(TWO_SOURCES);
  const rows = rowsOf(html);
  assert.equal(rows.length, 2);
  for (const [i, s] of TWO_SOURCES.sources.entries()) {
    const row = rows[i]!;
    assert.ok(row.includes(`>${s.name}<`), `row ${i} shows the media name`);
    const a = /<a [^>]*data-original-link[^>]*>/.exec(row)?.[0] ?? /<a [^>]*href="https?:[^>]*>/.exec(row)?.[0];
    assert.ok(a, `row ${i} has an external link`);
    assert.ok(a.includes(`href="${s.url}"`), `row ${i} links to the original article`);
    assert.ok(a.includes('target="_blank"'), `row ${i} opens a new tab`);
    assert.match(a, /rel="[^"]*noopener[^"]*"/);
    // The on-site report page stays as a secondary link.
    assert.ok(row.includes(`href="/items/${s.itemId}"`), `row ${i} keeps the on-site link`);
    assert.ok(!row.includes(MISSING_URL_LABEL));
  }
});

test("a source without an original URL says 原文链接缺失 instead of linking only on-site", () => {
  const html = render({ timeline: [], sources: [{ name: "芥末堆", itemId: "33333333-3333-4333-8333-333333333333", publishedAt: "2026-11-10T07:26:22.000Z", url: null }] });
  assert.ok(html.includes(MISSING_URL_LABEL));
  assert.ok(!/href="https?:/.test(html));
});

test("non-http URLs count as missing", () => {
  const rows = sourceRows({ timeline: [], sources: [{ name: "x", itemId: "a", publishedAt: "2026-11-10T07:26:22.000Z", url: "javascript:alert(1)" }] });
  assert.equal(rows[0]!.url, null);
});
