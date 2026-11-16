import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const chrome = "/usr/bin/google-chrome";
const base = process.env.VOICES_URL || "https://edu-ai-hot.vercel.app/voices";
const tag = process.argv[2] || "after";
const outDir = "/workspace/edu-hot/prod/masonry";
const cacheBust = `${base}${base.includes("?") ? "&" : "?"}t=${Date.now()}`;

function summarizeHeights(heights) {
  const min = Math.min(...heights);
  const max = Math.max(...heights);
  return { min, max, ratio: min ? Number((max / min).toFixed(2)) : null, heights };
}

async function measureViewport(browser, width, height, shotName, doPerf) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  const cdp = await page.context().newCDPSession(page);
  if (doPerf) await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });

  await page.goto(cacheBust, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForSelector("article", { timeout: 45000 });
  await page.waitForTimeout(1200);

  const layout = await page.evaluate(() => {
    const cards = [...document.querySelectorAll("article.voice-card")].filter((el) => !el.classList.contains("voice-skel"));
    const first = cards.slice(0, 15);
    const boxes = first.map((el) => {
      const r = el.getBoundingClientRect();
      return { h: Math.round(r.height), x: Math.round(r.left), y: Math.round(r.top + window.scrollY) };
    });
    const allBoxes = cards.map((el) => {
      const r = el.getBoundingClientRect();
      return { h: Math.round(r.height), x: Math.round(r.left), y: Math.round(r.top + window.scrollY) };
    });
    const minY = allBoxes.length ? Math.min(...allBoxes.map((b) => b.y)) : 0;
    const firstRow = allBoxes.filter((b) => Math.abs(b.y - minY) < 90);
    const xs = [...new Set(firstRow.map((b) => b.x))].sort((a, b) => a - b);
    const visual = allBoxes.slice().sort((a, b) => a.y - b.y || a.x - b.x);
    const heights = visual.slice(0, 15).map((b) => b.h);
    const titles = first.map((el) => (el.querySelector("h2")?.textContent || "").slice(0, 80));
    let prefixCards = 0, prefixMarked = 0;
    const prefixMissing = [];
    for (const el of cards) {
      if (el.getAttribute("data-had-claimer-prefix") !== "1") continue;
      prefixCards += 1;
      const badges = [...el.querySelectorAll(".voice-badge")].map((b) => (b.textContent || "").trim());
      const ok = badges.some((b) => b.includes("未查到原文") || b === "帖主转述" || b === "帖主自述");
      if (ok) prefixMarked += 1;
      else prefixMissing.push((el.querySelector("h2")?.textContent || "").slice(0, 40));
    }
    const metas = [...document.querySelectorAll(".voice-meta")];
    const metaOverflow = metas.filter((el) => el.scrollWidth > el.clientWidth + 1).length;
    const titleStats = [...document.querySelectorAll("h2.voice-cover-title")].slice(0, 20).map((el) => {
      const lh = parseFloat(getComputedStyle(el).lineHeight) || 24;
      const lines = Math.max(1, Math.round(el.getBoundingClientRect().height / lh));
      const text = el.textContent || "";
      return { lines, chars: text.length, charsPerLine: Number((text.length / lines).toFixed(1)), w: Math.round(el.getBoundingClientRect().width) };
    });
    return {
      cardCount: cards.length,
      heights,
      cols: xs.length,
      xs,
      titles,
      docHeight: document.documentElement.scrollHeight,
      prefixCards,
      prefixMarked,
      prefixMissing,
      metaOverflow,
      minCharsPerLine: titleStats.length ? Math.min(...titleStats.map((s) => s.charsPerLine)) : null,
      titleStats,
    };
  });

  const startIds = await page.evaluate(() =>
    [...document.querySelectorAll("article.voice-card, article.card")]
      .map((el) => el.querySelector("h2")?.textContent || "")
      .filter(Boolean),
  );

  let perf = null;
  if (doPerf) {
    perf = await page.evaluate(async () => {
      const longTasks = [];
      let po;
      try {
        po = new PerformanceObserver((list) => {
          for (const e of list.getEntries()) longTasks.push(e.duration);
        });
        po.observe({ type: "longtask", buffered: true });
      } catch { /* older */ }

      const frames = [];
      let last = performance.now();
      let raf = requestAnimationFrame(function tick(t) {
        frames.push(t - last);
        last = t;
        raf = requestAnimationFrame(tick);
      });

      const firstPos = () =>
        [...document.querySelectorAll("article.voice-card, article.card")].slice(0, 8).map((el) => {
          const r = el.getBoundingClientRect();
          return { id: el.querySelector("h2")?.textContent || "", left: Math.round(r.left), top: Math.round(r.top + scrollY) };
        });
      const before = firstPos();
      const startCount = document.querySelectorAll("article.voice-card, article.card").length;
      const viewH = window.innerHeight;
      let stalled = 0;
      let lastCount = startCount;
      let lastGrow = performance.now();

      for (let i = 0; i < 30; i++) {
        const beforeH = document.documentElement.scrollHeight;
        window.scrollBy(0, viewH);
        await new Promise((r) => setTimeout(r, 90));
        const count = document.querySelectorAll("article.voice-card, article.card").length;
        if (count > lastCount) {
          lastCount = count;
          lastGrow = performance.now();
        }
        const atBottom = window.scrollY + viewH >= document.documentElement.scrollHeight - 4;
        if (atBottom && count === lastCount && performance.now() - lastGrow > 2500 && i < 28) {
          stalled += 1;
        }
        void beforeH;
      }

      cancelAnimationFrame(raf);
      po?.disconnect();
      const after = firstPos();
      const jumps = before.filter((b) => {
        const a = after.find((x) => x.id === b.id);
        return a && a.left !== b.left;
      }).length;

      const titles = [...document.querySelectorAll("article.voice-card h2, article.card h2")].map((el) => el.textContent || "");
      const dup = titles.length - new Set(titles).size;
      return {
        startCount,
        endCount: lastCount,
        stalledScreens: stalled,
        jumps,
        longTasks: longTasks.length,
        longTaskMs: Math.round(longTasks.reduce((s, n) => s + n, 0)),
        frames: frames.length,
        droppedEst: frames.filter((d) => d > 22).length,
        longFrames: frames.filter((d) => d > 50).length,
        avgFrame: Number((frames.reduce((s, n) => s + n, 0) / Math.max(frames.length, 1)).toFixed(2)),
        maxFrame: Number(Math.max(0, ...frames).toFixed(2)),
        dupTitles: dup,
        scrollY: Math.round(window.scrollY),
        docHeight: document.documentElement.scrollHeight,
      };
    });
  }

  const afterLoad = await page.evaluate(() => {
    const hrefs = [...document.querySelectorAll("article.voice-card a.voice-cover")].map((el) => el.href);
    const titles = [...document.querySelectorAll("article.voice-card h2")].map((el) => el.textContent || "");
    return {
      hrefs: hrefs.length,
      dupHrefs: hrefs.length - new Set(hrefs).size,
      dupTitles: titles.length - new Set(titles).size,
    };
  });
  const duplicates = afterLoad.dupHrefs;

  await page.evaluate(() => window.scrollTo(0, 240));
  await page.waitForTimeout(300);
  const shotPath = path.join(outDir, shotName);
  await page.screenshot({ path: shotPath, fullPage: false });

  await context.close();
  const heightStats = summarizeHeights(layout.heights.length ? layout.heights : [0]);
  return {
    width,
    height,
    ...heightStats,
    cols: layout.cols,
    initialCards: layout.cardCount,
    startTitles: startIds.length,
    duplicates,
    consoleErrors,
    shotPath,
    perf,
    docHeight: layout.docHeight,
    prefixCards: layout.prefixCards,
    prefixMarked: layout.prefixMarked,
    prefixMissing: layout.prefixMissing,
    metaOverflow: layout.metaOverflow,
    minCharsPerLine: layout.minCharsPerLine,
  };
}

const browser = await chromium.launch({
  executablePath: chrome,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

const results = {
  tag,
  url: cacheBust,
  at: new Date().toISOString(),
  v1440: await measureViewport(browser, 1440, 900, `${tag}-1440.png`, true),
  v390: await measureViewport(browser, 390, 844, `${tag}-390.png`, true),
  v360: await measureViewport(browser, 360, 800, `${tag}-360.png`, false),
};

await browser.close();
const out = path.join(outDir, `${tag}-metrics.json`);
fs.writeFileSync(out, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
