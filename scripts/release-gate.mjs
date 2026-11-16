#!/usr/bin/env node
/**
 * Production file-deploy gate and ship log.
 *
 *   node scripts/release-gate.mjs --target preview
 *   node scripts/release-gate.mjs --target production
 *   node scripts/release-gate.mjs --shipped --deployment dpl_… --url https://… --target preview
 *
 * Production refuses a dirty tree, a HEAD not listed in RELEASES/accepted.txt
 * (体验大师 writes that file; author bots must not), or a build without a
 * single root-*.css. Preview only reports the SHA and CSS. --shipped appends
 * RELEASES/shipped.jsonl (gitignored).
 */
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const ACCEPTED = path.join(ROOT, "RELEASES/accepted.txt");
export const SHIPPED = path.join(ROOT, "RELEASES/shipped.jsonl");

export function gitSha(cwd = ROOT) {
  return execSync("git rev-parse HEAD", { cwd, encoding: "utf8" }).trim();
}

export function gitPorcelain(cwd = ROOT) {
  return execSync("git status --porcelain", { cwd, encoding: "utf8" });
}

export function parseAccepted(text) {
  const shas = new Set();
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const sha = t.split(/\s+/)[0].toLowerCase();
    if (/^[0-9a-f]{7,40}$/.test(sha)) shas.add(sha);
  }
  return shas;
}

export function isAccepted(sha, accepted) {
  const list = accepted ?? parseAccepted(existsSync(ACCEPTED) ? readFileSync(ACCEPTED, "utf8") : "");
  const full = sha.toLowerCase();
  for (const a of list) {
    if (a.length < 7 || full.length < 7) continue;
    if (full === a || full.startsWith(a) || a.startsWith(full)) return true;
  }
  return false;
}

export function builtCss(assetsDir = path.join(ROOT, ".vercel/output/static/assets")) {
  if (!existsSync(assetsDir)) return { error: "no .vercel/output/static/assets (build first)" };
  const names = readdirSync(assetsDir).filter((n) => /^root-.*\.css$/.test(n) && !n.endsWith(".br"));
  if (names.length !== 1) return { error: `expected one root-*.css, found ${names.join(",") || "none"}` };
  const name = names[0];
  const buf = readFileSync(path.join(assetsDir, name));
  return { file: `assets/${name}`, sha256: createHash("sha256").update(buf).digest("hex"), size: buf.length };
}

export function assertProductionGate({ sha } = {}) {
  const dirty = gitPorcelain().trim();
  if (dirty) {
    throw new Error(`Production file-deploy refused: git status is not clean:\n${dirty}`);
  }
  const head = gitSha();
  const use = (sha || head).toLowerCase();
  if (use !== head.toLowerCase()) {
    throw new Error(`Production file-deploy refused: requested SHA ${use} is not HEAD ${head}`);
  }
  if (!isAccepted(use)) {
    throw new Error(`Production file-deploy refused: ${use} is not listed in RELEASES/accepted.txt (体验大师 writes that file). Preview deploys may proceed without being listed.`);
  }
  const css = builtCss();
  if (css.error) {
    throw new Error(`Production file-deploy refused: ${css.error}`);
  }
  return { sha: head, css };
}

export function recordShipped(entry) {
  mkdirSync(path.dirname(SHIPPED), { recursive: true });
  const row = { at: new Date().toISOString(), ...entry };
  appendFileSync(SHIPPED, JSON.stringify(row) + "\n");
  return row;
}

export function reportRelease({ target = "preview" } = {}) {
  const sha = gitSha();
  const css = builtCss();
  const accepted = isAccepted(sha);
  return { sha, target, css, accepted, dirty: gitPorcelain().trim() };
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const target = arg("--target") || "preview";
  if (process.argv.includes("--shipped")) {
    const sha = arg("--sha") || gitSha();
    const row = recordShipped({
      sha,
      target,
      deployment: arg("--deployment") || null,
      url: arg("--url") || null,
      css: builtCss(),
    });
    console.log(`shipped: ${SHIPPED}`);
    console.log(JSON.stringify(row, null, 2));
    process.exit(0);
  }
  if (target === "production") {
    const r = assertProductionGate();
    console.log(`production gate ok: ${r.sha}`);
    console.log(`css: ${r.css.file} sha256=${r.css.sha256} size=${r.css.size}`);
    process.exit(0);
  }
  const r = reportRelease({ target });
  console.log(`preview: sha=${r.sha} accepted=${r.accepted} dirty=${Boolean(r.dirty)}`);
  if (r.css.error) console.log(`css: ${r.css.error}`);
  else console.log(`css: ${r.css.file} sha256=${r.css.sha256} size=${r.css.size}`);
  if (r.dirty) console.log("warning: git status is not clean (allowed for preview).");
}
