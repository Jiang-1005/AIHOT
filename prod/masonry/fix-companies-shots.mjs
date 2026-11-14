import { chromium } from "playwright";
import fs from "node:fs";

const OUT = "/workspace/edu-hot/prod/masonry";
fs.mkdirSync(OUT, { recursive: true });
const ts = Date.now();
const base = "https://edu-ai-hot.vercel.app";
const height = (w) => (w >= 1440 ? 1000 : w >= 390 ? 844 : 800);
const widths = [360, 390, 1440];

function collectErrors(page) {
  const consoles = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoles.push({ type: "console", text: msg.text() });
  });
  page.on("pageerror", (err) => consoles.push({ type: "pageerror", text: String(err) }));
  return consoles;
}

async function inspect(page) {
  return page.evaluate(() => {
    const overflow = document.documentElement.scrollWidth > window.innerWidth + 1;
    const articles = [...document.querySelectorAll("article")];
    const cards = articles.map((el) => {
      const title = (el.querySelector("h3")?.innerText || "").trim();
      const tagEls = [...el.querySelectorAll("a, span")].filter((n) => /^#\S/.test((n.textContent || "").trim()));
      const tags = tagEls.map((n) => {
        const cs = getComputedStyle(n);
        const r = n.getBoundingClientRect();
        const parent = n.parentElement ? getComputedStyle(n.parentElement) : null;
        const visible =
          cs.display !== "none" &&
          cs.visibility !== "hidden" &&
          Number(cs.opacity) !== 0 &&
          r.width > 0 &&
          r.height > 0 &&
          (!parent || (parent.display !== "none" && parent.visibility !== "hidden"));
        return { text: (n.textContent || "").trim(), visible };
      });
      const visibleTags = tags.filter((t) => t.visible).map((t) => t.text);
      return { title: title.slice(0, 60), tagCount: tags.length, visibleTags, hiddenTags: tags.filter((t) => !t.visible).map((t) => t.text) };
    });
    const withTags = cards.filter((c) => c.tagCount > 0);
    const missingLead = withTags.filter((c) => c.visibleTags.length === 0);
    return {
      title: document.title,
      overflow,
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      cardCount: articles.length,
      tagged: withTags.length,
      missingLead: missingLead.map((c) => c.title),
      sample: withTags.slice(0, 8),
    };
  });
}

const browser = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

const report = { ts, deployHint: "dpl_aqaMGCuMtpUXy4YMTqZV2msZvBEm", results: [] };

for (const view of [
  { key: "time", path: "/companies?view=time", shot: true },
  { key: "company", path: "/companies?view=company", shot: false },
]) {
  for (const w of widths) {
    const h = height(w);
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    const consoles = collectErrors(page);
    const url = `${base}${view.path}&ts=${ts}`;
    await page.goto(url, { waitUntil: "networkidle", timeout: 90000 });
    await page.waitForSelector("article", { timeout: 45000 });
    await page.waitForTimeout(1200);
    let shotPath = null;
    if (view.shot) {
      shotPath = `${OUT}/fix-companies-${w}.png`;
      await page.screenshot({ path: shotPath, fullPage: false });
    }
    const info = await inspect(page);
    const entry = { view: view.key, w, h, url, file: shotPath, info, consoles };
    report.results.push(entry);
    console.log(JSON.stringify({
      view: view.key,
      w,
      file: shotPath,
      cards: info.cardCount,
      tagged: info.tagged,
      missingLead: info.missingLead.length,
      overflow: info.overflow,
      errors: consoles.length,
      sampleVisible: info.sample.map((c) => c.visibleTags),
    }));
    await page.close();
  }
}

await browser.close();
fs.writeFileSync("/tmp/fix-companies-shots-report.json", JSON.stringify(report, null, 2));
const errN = report.results.reduce((n, r) => n + r.consoles.length, 0);
const miss = report.results.filter((r) => r.info.missingLead.length);
const ov = report.results.filter((r) => r.info.overflow);
console.log("TOTAL_CONSOLE_ERRORS", errN);
console.log("MISSING_LEAD", miss.map((r) => `${r.view}-${r.w}:${r.info.missingLead.join("|")}`));
console.log("OVERFLOW", ov.map((r) => `${r.view}-${r.w}`));
