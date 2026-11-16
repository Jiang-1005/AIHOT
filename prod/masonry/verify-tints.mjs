import { chromium } from "@playwright/test";
import fs from "node:fs";

const chrome = "/usr/bin/google-chrome";
const base = process.env.VOICES_URL || "https://edu-ai-hot.vercel.app/voices";
const url = `${base}${base.includes("?") ? "&" : "?"}t=${Date.now()}`;
const outDir = "/workspace/edu-hot/prod/masonry";

async function check(page, width, height, shotName) {
  await page.setViewportSize({ width, height });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForSelector("article.voice-card", { timeout: 45000 });
  await page.waitForTimeout(1200);
  const errors = [];
  page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
  page.on("pageerror", (err) => errors.push(String(err)));

  const result = await page.evaluate(() => {
    const cards = [...document.querySelectorAll("article.voice-card")].filter((el) => !el.classList.contains("voice-skel"));
    const first = cards.slice(0, 16);
    const covers = first.map((el) => {
      const a = el.querySelector("a.voice-cover");
      const cs = a ? getComputedStyle(a) : null;
      const meta = el.querySelector(".voice-meta");
      return {
        tint: a?.getAttribute("data-cover-tint") || (a ? [...a.classList].filter((c) => c.startsWith("voice-cover-") && c !== "voice-cover").join(" ") : ""),
        bg: cs ? cs.backgroundColor : "",
        platform: el.getAttribute("data-platform") || "",
        metaOverflow: meta ? meta.scrollWidth > meta.clientWidth + 1 : false,
      };
    });
    const bgCounts = {};
    const tintCounts = {};
    for (const c of covers) {
      bgCounts[c.bg] = (bgCounts[c.bg] || 0) + 1;
      tintCounts[c.tint] = (tintCounts[c.tint] || 0) + 1;
    }
    const chips = [...document.querySelectorAll("button")].map((b) => b.textContent.trim()).filter((t) => ["全部", "小红书", "X", "中文社区"].includes(t));
    const marks = [...new Set(covers.map((c) => c.platform))];
    return {
      visibleCards: cards.length,
      first16: covers.length,
      distinctBgs: Object.keys(bgCounts).length,
      bgCounts,
      tintCounts,
      maxBgShare: covers.length ? Math.max(...Object.values(bgCounts)) / covers.length : 0,
      metaOverflow: covers.filter((c) => c.metaOverflow).length,
      platformsOnFirst: marks,
      chips,
    };
  });

  await page.screenshot({ path: `${outDir}/${shotName}`, fullPage: false });
  // re-listen? errors may have been missed because listeners were added after goto. Recollect via a short wait already happened.
  return { ...result, shot: shotName, consoleErrors: errors };
}

const browser = await chromium.launch({ executablePath: chrome, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const context = await browser.newContext();
const consoleErrors = [];
const page = await context.newPage();
page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
page.on("pageerror", (err) => consoleErrors.push(String(err)));

const r1440 = await check(page, 1440, 900, "after3-1440.png");
const r390 = await check(page, 390, 844, "after3-390.png");
const r360 = await check(page, 360, 800, "after3-360.png");
r1440.consoleErrors = consoleErrors.filter((e) => true);
await browser.close();

const report = { r1440, r390, r360, consoleErrors };
fs.writeFileSync(`${outDir}/after3-metrics.json`, JSON.stringify(report, null, 2));
const ok1440 = r1440.distinctBgs >= 4 && r1440.maxBgShare <= 0.5 && r1440.consoleErrors.length === 0;
console.log(JSON.stringify({
  ok1440,
  distinctBgs1440: r1440.distinctBgs,
  maxBgShare1440: r1440.maxBgShare,
  tintCounts1440: r1440.tintCounts,
  metaOverflow360: r360.metaOverflow,
  metaOverflow390: r390.metaOverflow,
  chips: r1440.chips,
  platformsOnFirst: r1440.platformsOnFirst,
  consoleErrors: consoleErrors.slice(0, 8),
  shots: ["after3-1440.png", "after3-390.png", "after3-360.png"],
}, null, 2));
process.exit(ok1440 && r360.metaOverflow === 0 && consoleErrors.length === 0 ? 0 : 2);
