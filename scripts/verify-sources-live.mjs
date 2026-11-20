#!/usr/bin/env node
/**
 * Validate industry/sources.json against config-keys.ts and optionally probe every
 * RSS / JSON / HTML listing live over HTTP.
 *
 * Usage:
 *   node scripts/verify-sources-live.mjs
 *   node scripts/verify-sources-live.mjs --live
 *   node scripts/verify-sources-live.mjs --live --file=path/to/candidates.json
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { unsupportedConfig } from "../packages/backend/src/sources/config-keys.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VALID_TIERS = new Set(["T1", "T1_5", "T2", "EXCLUDE_MP"]);
const VALID_MODES = new Set(["editorial", "hot_signal", "isolated"]);
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function parseArgs(argv) {
  const opts = { live: false, file: path.join(ROOT, "industry", "sources.json"), timeoutMs: 12000 };
  for (const arg of argv) {
    if (arg === "--live") opts.live = true;
    else if (arg.startsWith("--file=")) opts.file = path.resolve(arg.slice("--file=".length));
    else if (arg.startsWith("--timeout=")) opts.timeoutMs = Math.max(2000, Number(arg.slice("--timeout=".length)) || 12000);
  }
  return opts;
}

export function validateSourceCatalog(catalog) {
  const errors = [];
  if (!catalog || !Array.isArray(catalog.sources)) {
    return ["sources.json must contain a top-level 'sources' array"];
  }
  const seen = new Set();
  for (const s of catalog.sources) {
    if (!s || typeof s !== "object") {
      errors.push("invalid source entry (not an object)");
      continue;
    }
    if (!s.id || typeof s.id !== "string") errors.push(`missing id on ${JSON.stringify(s.name)}`);
    else if (seen.has(s.id)) errors.push(`duplicate source id: ${s.id}`);
    else seen.add(s.id);

    if (!s.name || typeof s.name !== "string") errors.push(`${s.id}: missing name`);
    if (!VALID_TIERS.has(s.tier)) errors.push(`${s.id}: invalid tier ${String(s.tier)}`);
    if (!VALID_MODES.has(s.participation_mode)) errors.push(`${s.id}: invalid participation_mode ${String(s.participation_mode)}`);

    const bad = unsupportedConfig(s.kind, s.config ?? {});
    if (bad.length) errors.push(`${s.id}: unsupported config keys: ${bad.join(", ")}`);

    if (s.kind === "rss" && !s.config?.feedUrl) errors.push(`${s.id}: rss requires config.feedUrl`);
    if ((s.kind === "web_list" || s.kind === "json_list") && !s.config?.url) errors.push(`${s.id}: ${s.kind} requires config.url`);
  }
  return errors;
}

function getPath(obj, dotPath) {
  if (!dotPath) return obj;
  let cur = obj;
  for (const seg of String(dotPath).split(".")) {
    if (cur == null) return undefined;
    cur = cur[seg];
  }
  return cur;
}

function targetUrl(s) {
  if (s.kind === "rss") return s.config?.feedUrl;
  if (s.kind === "web_list" || s.kind === "json_list") return s.config?.url;
  return null;
}

function countParsedItems(s, body) {
  if (s.kind === "rss") {
    const items = body.match(/<(?:item|entry)(?:\s|>)/gi);
    return items ? items.length : 0;
  }
  if (s.kind === "json_list") {
    const data = JSON.parse(body);
    const arr = s.config?.itemsPath ? getPath(data, s.config.itemsPath) : data;
    return Array.isArray(arr) ? arr.length : 0;
  }
  if (s.kind === "web_list") {
    const links = body.match(/<a\b[^>]+href=/gi);
    return links ? links.length : 0;
  }
  return 0;
}

async function probeOne(s, timeoutMs) {
  const url = targetUrl(s);
  if (!url) return { id: s.id, name: s.name, ok: true, status: "skip", items: 0, ms: 0 };
  const started = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const headers = { "User-Agent": UA, Accept: "application/rss+xml, application/atom+xml, application/xml, application/json, text/html, */*" };
    if (s.config?.acceptLanguage) headers["Accept-Language"] = s.config.acceptLanguage;
    const res = await fetch(url, { headers, signal: ctl.signal, redirect: "follow" });
    const text = await res.text();
    const ms = Date.now() - started;
    if (!res.ok) return { id: s.id, name: s.name, ok: false, status: res.status, items: 0, ms, error: `HTTP ${res.status}` };
    const items = countParsedItems(s, text);
    if (items === 0) return { id: s.id, name: s.name, ok: false, status: res.status, items: 0, ms, error: "0 parsed items" };
    return { id: s.id, name: s.name, ok: true, status: res.status, items, ms };
  } catch (err) {
    return { id: s.id, name: s.name, ok: false, status: "ERR", items: 0, ms: Date.now() - started, error: err?.name === "AbortError" ? "timeout" : String(err?.message || err) };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const raw = JSON.parse(readFileSync(opts.file, "utf8"));
  const errors = validateSourceCatalog(raw);
  if (errors.length) {
    for (const e of errors) console.error(`ERROR: ${e}`);
    process.exit(1);
  }
  console.log(`Config validation OK: ${raw.sources.length} sources in ${path.relative(ROOT, opts.file)}`);
  if (!opts.live) return;

  const queue = [...raw.sources];
  const results = [];
  const workers = Array.from({ length: 8 }, async () => {
    while (queue.length) {
      const next = queue.shift();
      if (next) results.push(await probeOne(next, opts.timeoutMs));
    }
  });
  await Promise.all(workers);

  const byId = new Map(results.map((r) => [r.id, r]));
  let failed = 0;
  for (const s of raw.sources) {
    const r = byId.get(s.id);
    if (!r) continue;
    if (r.ok) {
      console.log(`  OK   ${r.id.padEnd(28)} status=${String(r.status).padEnd(4)} items=${String(r.items).padStart(3)} ${r.ms}ms`);
    } else {
      failed++;
      console.log(`  FAIL ${r.id.padEnd(28)} status=${String(r.status).padEnd(4)} ${r.error}`);
    }
  }
  console.log(`Live probe complete: ${raw.sources.length - failed}/${raw.sources.length} reachable & parseable.`);
  if (failed > 0) process.exitCode = 2;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
