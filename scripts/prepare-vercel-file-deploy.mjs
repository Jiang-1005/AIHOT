#!/usr/bin/env node
/**
 * Prepare a file list for a Vercel file deployment (upload_file + create_deployment).
 *
 * create_deployment accepts either:
 *   - inlined files: { file, data, encoding: "utf-8"|"base64" }  — only practical for tiny trees
 *   - uploaded files: first upload_file (SHA1 + size + base64 body), then
 *     create_deployment requestBody.files = [{ file, sha, size }]
 *
 * This script only writes a manifest. It does not upload or create a deployment.
 *
 * Usage:
 *   node scripts/prepare-vercel-file-deploy.mjs
 *   node scripts/prepare-vercel-file-deploy.mjs --out /tmp/edu-hot-vercel-files.json
 *
 * Do not include .env or .secrets in the manifest.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const SKIP_DIRS = new Set([
  ".git", ".data", ".secrets", "node_modules", "__pycache__", ".cursor",
  "agent-tools", "uploads",
  "tests", "docs", "deploy", ".github", ".claude",
]);
const SKIP_FILES = new Set([
  ".env", ".DS_Store",
]);
const SKIP_SUFFIXES = [
  ".pid", ".log", ".dump", ".pyc",
];
const KEEP_MEDIA_PREFIXES = ["static/", "site/", "apps/", "packages/", "industry/", "assets/", "modules/"];
const SKIP_MEDIA = [".png", ".jpg", ".jpeg", ".webp", ".gif"];
const SKIP_PATHS = new Set([
  "apps/web/build",
  "deploy/internal-gate.env",
  "deploy/gate.log",
  "deploy/gate.pid",
  "deploy/tunnel.log",
  "deploy/tunnel.pid",
  "deploy/tunnel.log.cf-proxy-fail",
  "deploy/tunnel.log.http2-fail",
  "deploy/tunnel.log.lr-dnsfail",
  "deploy/tunnel.log.quic-fail",
  "deploy/hosts.cf",
]);

function skip(rel, isDir) {
  const parts = rel.split(path.sep);
  if (parts.some((p) => SKIP_DIRS.has(p) || p === "node_modules")) return true;
  if (SKIP_PATHS.has(rel) || [...SKIP_PATHS].some((p) => rel === p || rel.startsWith(p + "/"))) return true;
  const base = parts[parts.length - 1] ?? "";
  if (SKIP_FILES.has(base) || base.startsWith(".env")) return true;
  if (base === "vercel.env") return true;
  if (!isDir && SKIP_SUFFIXES.some((s) => base.toLowerCase().endsWith(s))) return true;
  // Keep runtime images/fonts under static/site/apps; drop repo-root screenshots.
  if (!isDir && SKIP_MEDIA.some((s) => base.toLowerCase().endsWith(s))) {
    const keep = KEEP_MEDIA_PREFIXES.some((p) => rel === p.slice(0, -1) || rel.startsWith(p));
    if (!keep) return true;
  }
  if (rel === "scripts/.vercel-file-manifest.json") return true;
  return false;
}

function walk(dir, acc) {
  for (const name of readdirSync(dir)) {
    const abs = path.join(dir, name);
    const rel = path.relative(ROOT, abs).replaceAll("\\", "/");
    let st;
    try { st = statSync(abs); } catch { continue; }
    if (st.isDirectory()) {
      if (skip(rel, true)) continue;
      walk(abs, acc);
    } else if (st.isFile()) {
      if (skip(rel, false)) continue;
      acc.push({ abs, rel, size: st.size });
    }
  }
}

const outFlag = process.argv.indexOf("--out");
const outPath = outFlag >= 0 && process.argv[outFlag + 1]
  ? path.resolve(process.argv[outFlag + 1])
  : path.join(ROOT, "scripts", ".vercel-file-manifest.json");

const files = [];
walk(ROOT, files);
files.sort((a, b) => a.rel.localeCompare(b.rel));

const entries = files.map(({ abs, rel, size }) => {
  const buf = readFileSync(abs);
  const sha = createHash("sha1").update(buf).digest("hex");
  if (buf.length !== size) throw new Error(`size changed while reading ${rel}`);
  return { file: rel, sha, size };
});

mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify({
  createdAt: new Date().toISOString(),
  root: ROOT,
  count: entries.length,
  totalBytes: entries.reduce((n, f) => n + f.size, 0),
  files: entries,
}, null, 2));

const total = entries.reduce((n, f) => n + f.size, 0);
console.log(`manifest: ${outPath}`);
console.log(`files: ${entries.length}`);
console.log(`totalBytes: ${total}`);
console.log("next: upload each file with user-Vercel upload_file (xVercelDigest=sha, contentLength=size, requestBody=base64), then create_deployment with files:[{file,sha,size}], skipAutoDetectionConfirmation=1. Do not deploy until DATABASE_URL is set.");
