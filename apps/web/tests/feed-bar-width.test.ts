// Failures: at 320px the feed PhoneBar's 「全部」 tab painted under 筛选 (2026-11-16). The three
// scope tabs must stay fully visible and clear of the 44px filter and search buttons at 320, 360
// and 390, without widening the page.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, expect, type Browser, type Page } from "@playwright/test";
import { FIXTURE_AT as at, fakeApi, feedItem, startWebServer, visit, type WebServer } from "./web-server.ts";

const emptyFacets = { vocab: { topic: [], subject: [], form: [], content_type: [] }, headCompanies: [], logos: { index: {} }, counts: {} };
const api = fakeApi((url) => {
  const path = url.pathname;
  if (path === "/api/site/timeline") {
    return {
      filters: { channel: "all", category: null, tag: null },
      cards: [{ key: "g1", anchorAt: at, item: feedItem({ id: "rep-1", title: "代表文章" }), group: null }],
      nextCursor: null,
      hot: null,
      dayCounts: { "2026-10-04": 1 },
    };
  }
  if (path === "/api/site/facets") return emptyFacets;
  if (path === "/api/site/topics") return { groups: [], topics: [] };
  if (path === "/api/site/hot") return { computedAt: at, windowHours: 48, entries: [] };
  if (path === "/api/site/reports/daily") return { kind: "daily", items: [{ key: "2026-11-15", issueNumber: 6 }] };
});

let web: WebServer;
let chrome: Browser;

function launch() {
  const executable = process.env.PLAYWRIGHT_CHROME ?? "/usr/bin/google-chrome-stable";
  return chromium.launch({ executablePath: executable, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
}

before(async () => {
  web = await startWebServer(api);
  chrome = await launch();
});
after(async () => {
  await chrome?.close();
  await web?.stop();
});

type Box = { x: number; y: number; w: number; h: number; right: number; left: number; top: number; bottom: number };

function overlap(a: Box, b: Box, slack = 0.5): boolean {
  return a.left < b.right - slack && a.right > b.left + slack && a.top < b.bottom - slack && a.bottom > b.top + slack;
}

async function barLayout(page: Page) {
  return page.evaluate(() => {
    const bar = document.querySelector<HTMLElement>("header[data-phone-bar]");
    if (!bar) return null;
    const box = (el: Element | null): Box | null => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    };
    const scope = bar.querySelector("[aria-label='看精选、往期或全部']");
    const tabs = ["精选", "往期", "全部"].map((name) => {
      const el = [...(scope?.querySelectorAll("a") ?? [])].find((a) => (a.textContent || "").trim() === name) ?? null;
      return { name, box: box(el), inViewport: !!el && (() => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.left >= -0.5 && r.right <= window.innerWidth + 0.5;
      })() };
    });
    return {
      width: window.innerWidth,
      bar: box(bar),
      home: box(bar.querySelector("a[aria-label$='首页']")),
      wordmark: (() => {
        const el = bar.querySelector("a[aria-label$='首页'] span.font-black");
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return getComputedStyle(el).display !== "none" && r.width > 0;
      })(),
      filter: box(bar.querySelector("button[aria-label^='筛选']")),
      search: box(bar.querySelector("button[aria-label='搜索']")),
      tabs,
    };
  });
}

for (const width of [320, 360, 390] as const) {
  test(`feed PhoneBar keeps 精选/往期/全部 clear of 筛选 at ${width}px`, async () => {
    const context = await chrome.newContext({ viewport: { width, height: 844 }, isMobile: true, locale: "zh-CN", reducedMotion: "reduce" });
    try {
      const page = await context.newPage();
      await visit(page, web.origin + "/");
      if (await page.getByRole("heading", { name: "暂时无法加载" }).isVisible().catch(() => false)) {
        throw new Error(`home failed to load at ${width}px: ${web.logs()}`);
      }
      await expect(page.getByRole("navigation", { name: "看精选、往期或全部" })).toBeVisible();
      const layout = await barLayout(page);
      assert.ok(layout, "phone bar should render");
      assert.ok(layout.filter && layout.search, "filter and search should be present");
      assert.equal(Math.round(layout.filter.h), 44, "筛选 should stay a 44px target");
      assert.equal(Math.round(layout.search.h), 44, "搜索 should stay a 44px target");
      assert.equal(Math.round(layout.filter.w), 44);
      assert.equal(Math.round(layout.search.w), 44);
      assert.ok(layout.home && Math.round(layout.home.h) === 44, "home control should stay 44px tall");
      if (width < 360) {
        assert.equal(layout.wordmark, false, "320 uses the compact ring, not the full wordmark");
        assert.ok(Math.round(layout.home.w) >= 44, "compact home target should be at least 44px wide");
      } else {
        assert.equal(layout.wordmark, true, `${width} should keep the site wordmark`);
      }
      for (const tab of layout.tabs) {
        assert.ok(tab.box && tab.inViewport, `${tab.name} should be fully visible at ${width}px`);
        assert.ok(!overlap(tab.box, layout.filter), `${tab.name} overlaps 筛选 at ${width}px`);
        assert.ok(!overlap(tab.box, layout.search), `${tab.name} overlaps 搜索 at ${width}px`);
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(overflow <= 1, `page should not scroll sideways at ${width}px (overflow ${overflow})`);

      const masthead = await page.evaluate(() => {
        // The site name in the newspaper masthead (not the phone bar wordmark).
        const title = document.querySelector("header p.font-serif") as HTMLElement | null;
        const meta = title?.parentElement?.querySelector("p.kicker:not(.hidden)") as HTMLElement | null;
        const box = (el: Element | null) => {
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: r.width, h: r.height, text: (el.textContent || "").replace(/\s+/g, " ").trim() };
        };
        const t = box(title);
        const m = box(meta && getComputedStyle(meta).display !== "none" ? meta : null);
        const overlap = !!(t && m && t.left < m.right - 0.5 && t.right > m.left + 0.5 && t.top < m.bottom - 0.5 && t.bottom > m.top + 0.5);
        return { title: t, meta: m, overlap };
      });
      assert.ok(masthead.title && masthead.title.text.includes("教育AI HOT"), `masthead title should be complete at ${width}px`);
      assert.equal(masthead.overlap, false, `masthead title overlaps the issue line at ${width}px`);
      if (masthead.meta) {
        assert.ok(masthead.meta.right <= width + 0.5, `issue line overflows the viewport at ${width}px`);
      }
    } finally {
      await context.close();
    }
  });
}
