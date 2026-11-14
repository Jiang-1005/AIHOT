#!/usr/bin/env node
/**
 * Build a Vercel Build Output API v3 tree at .vercel/output so we can file-deploy
 * prebuilt static assets + two bundled Node functions (no cloud-side npm ci).
 *
 *   node scripts/build-vercel-output.mjs
 *
 * Functions:
 *   api.func  — Fastify API. The bundle lives at packages/backend/src/index.js so
 *               REPO_ROOT (import.meta.dirname/../../..) still points at the
 *               function root, where site/, industry/, assets/, static/ are copied.
 *   ssr.func  — React Router SSR, fully bundled.
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, ".vercel/output");

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit", ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed (${r.status})`);
}

function copyDir(src, dest) {
  if (!existsSync(src)) return 0;
  mkdirSync(path.dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true });
  return 1;
}

function copyFile(src, dest) {
  if (!existsSync(src)) return 0;
  mkdirSync(path.dirname(dest), { recursive: true });
  cpSync(src, dest);
  return 1;
}

function esbuildBin() {
  const candidates = [
    path.join(ROOT, "node_modules/@esbuild/linux-x64/bin/esbuild"),
    path.join(ROOT, "node_modules/esbuild/bin/esbuild"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  try {
    // The JS shim is not executable with node once postinstall is skipped;
    // prefer the platform binary resolved next to the package.
    const pkg = path.dirname(require.resolve("esbuild/package.json"));
    const platform = path.join(pkg, "../@esbuild/linux-x64/bin/esbuild");
    if (existsSync(platform)) return platform;
  } catch {}
  return null;
}

function ensureEsbuild() {
  if (esbuildBin()) return;
  console.log("installing esbuild (no save)…");
  run("npm", ["install", "--no-save", "--no-package-lock", "esbuild"]);
}

function bundle(entry, outfile, { format = "esm", minify = false, extra = [] } = {}) {
  const bin = esbuildBin();
  if (!bin) throw new Error("esbuild is not installed");
  const stubDir = path.join(ROOT, "scripts/vercel-stubs");
  const args = [
    entry,
    "--bundle",
    "--platform=node",
    `--format=${format}`,
    "--target=node24",
    "--packages=bundle",
    `--alias:sharp=${path.join(stubDir, "sharp.js")}`,
    `--alias:pg-boss=${path.join(stubDir, "pg-boss.js")}`,
    `--alias:satori=${path.join(stubDir, "satori.js")}`,
    `--alias:@shuding/opentype.js=${path.join(stubDir, "opentype.js")}`,
    "--legal-comments=none",
    `--outfile=${outfile}`,
    ...extra,
  ];
  if (minify) args.push("--minify");
  // CJS avoids esbuild's ESM "Dynamic require of util is not supported" with react-dom/server.
  run(bin, args);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

ensureEsbuild();

const client = path.join(ROOT, "apps/web/build/client");
const server = path.join(ROOT, "apps/web/build/server/index.js");
if (!existsSync(client) || !existsSync(server)) {
  console.log("building @aihot/web…");
  run("npm", ["run", "build", "-w", "@aihot/web"]);
}

// Static client assets
cpSync(client, path.join(OUT, "static"), { recursive: true });

const apiRoot = path.join(OUT, "functions/api.func");
const apiFile = path.join(apiRoot, "packages/backend/src/index.js");
mkdirSync(path.dirname(apiFile), { recursive: true });
console.log("bundling API…");
bundle(path.join(ROOT, "api/index.ts"), apiFile, {
  format: "esm",
  minify: true,
  extra: [
    "--banner:js=import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  ],
});

// Runtime files the API still reads from disk (REPO_ROOT = function root).
for (const rel of [
  "site/public",
  "site/brand",
  "site/pages",
  "site/changelog.json",
  "industry/topics.json",
  "industry/prompts",
  "assets/og-fonts",
  "static/logos",
  "apps/web/public/logos",
]) {
  const src = path.join(ROOT, rel);
  const dest = path.join(apiRoot, rel);
  if (statSync(src, { throwIfNoEntry: false })?.isDirectory()) copyDir(src, dest);
  else copyFile(src, dest);
}

// sharp / libvips are not uploaded: the file-upload tool cannot inline files whose
// base64 is over 8 MB. OG / img-proxy may fail until a later pass; public pages do not need them.

writeFileSync(path.join(apiRoot, "package.json"), JSON.stringify({ type: "module" }) + "\n");
writeFileSync(path.join(apiRoot, ".vc-config.json"), JSON.stringify({
  runtime: "nodejs24.x",
  handler: "packages/backend/src/index.js",
  launcherType: "Nodejs",
  shouldAddHelpers: false,
  supportsResponseStreaming: true,
  regions: ["sin1"],
}, null, 2) + "\n");

// SSR entry that statically imports the React Router server build.
const ssrEntry = path.join(ROOT, "scripts/.vercel-ssr-entry.ts");
writeFileSync(ssrEntry, `import { createRequestListener } from "@react-router/node";
import type { ServerBuild } from "react-router";
import * as buildMod from "../apps/web/build/server/index.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { isApiOwned, resolveRedirect } from "@aihot/contracts/http-policy";
import { attachPublicCdnCache } from "@aihot/contracts/attach-public-cdn-cache";
import {
  ROBOTS_TAG, applyGateDecision, decideGate, gateMisconfigured, getCookieHeader,
  parseForm, requestIsSecure,
} from "../packages/backend/src/public-gate.ts";

if (gateMisconfigured()) {
  throw new Error("EDU_HOT_GATE_ENABLED is true but EDU_HOT_GATE_PASSWORD is not set");
}

const build = buildMod as unknown as ServerBuild;
const ssr = createRequestListener({ build, mode: "production" });

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const raw = req.url ?? "/";
  const qi = raw.indexOf("?");
  const pathname = qi >= 0 ? raw.slice(0, qi) : raw;
  const search = qi >= 0 ? raw.slice(qi) : "";

  res.setHeader("X-Robots-Tag", ROBOTS_TAG);

  const decision = resolveRedirect(pathname, search);
  if (decision) {
    for (const [k, v] of Object.entries(decision.headers)) res.setHeader(k, v);
    if (decision.location) res.setHeader("Location", decision.location);
    res.statusCode = decision.status;
    return res.end(decision.location ? undefined : decision.status === 410 ? "Gone" : "Not found");
  }

  let form: Record<string, string> | undefined;
  if ((req.method ?? "GET").toUpperCase() === "POST" && pathname === "/gate") {
    form = parseForm(await readBody(req));
  }
  if (applyGateDecision(decideGate({
    method: req.method ?? "GET",
    pathname,
    search,
    cookieHeader: getCookieHeader(req.headers),
    form,
    secure: requestIsSecure(req.headers),
  }), res)) return;

  if (isApiOwned(pathname)) {
    res.statusCode = 502;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.end("API route reached the page server");
  }

  attachPublicCdnCache(req, res, pathname, getCookieHeader(req.headers));
  return ssr(req, res);
}
`);

const ssrRoot = path.join(OUT, "functions/ssr.func");
mkdirSync(ssrRoot, { recursive: true });
console.log("bundling SSR…");
bundle(ssrEntry, path.join(ssrRoot, "index.js"), {
  format: "esm",
  minify: true,
  extra: [
    "--loader:.css=empty",
    "--loader:.svg=file",
    "--loader:.png=file",
    "--banner:js=import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  ],
});
writeFileSync(path.join(ssrRoot, "package.json"), JSON.stringify({ type: "module" }) + "\n");
writeFileSync(path.join(ssrRoot, ".vc-config.json"), JSON.stringify({
  runtime: "nodejs24.x",
  handler: "index.js",
  launcherType: "Nodejs",
  shouldAddHelpers: false,
  supportsResponseStreaming: true,
  regions: ["sin1"],
}, null, 2) + "\n");

const config = {
  version: 3,
  routes: [
    { src: "/(.*)", headers: { "X-Robots-Tag": "noindex, nofollow" }, continue: true },
    { src: "^/assets/(.*)$", headers: { "Cache-Control": "public, max-age=31536000, immutable" }, continue: true },
    { handle: "filesystem" },
    { src: "^/api(?:/.*)?$", dest: "/api" },
    { src: "^/(?:feed(?:\\.xml)?|rss(?:\\.xml)?|atom\\.xml|openapi-v1\\.json|llms\\.txt|robots\\.txt|sitemap\\.xml)(?:/.*)?$", dest: "/api" },
    { src: "^/sitemaps(?:/.*)?$", dest: "/api" },
    { src: "^/\\.well-known(?:/.*)?$", dest: "/api" },
    { src: "^/og(?:/.*)?$", dest: "/api" },
    { src: "^/contact(?:/.*)?$", dest: "/api" },
    { src: "^/items/[^/]+/markdown$", dest: "/api" },
    { src: "^/(?:favicon\.ico|favicon\.png|icon\.png|icon-192\.png|apple-icon\.png|logo\.svg)$", dest: "/api" },
    { src: "^/manifest\.webmanifest$", dest: "/api" },
    { src: "^/(.*)$", dest: "/ssr" },
  ],
};
writeFileSync(path.join(OUT, "config.json"), JSON.stringify(config, null, 2) + "\n");

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const abs = path.join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) walk(abs, acc);
    else acc.push({ abs, rel: path.relative(ROOT, abs).replaceAll("\\", "/"), size: st.size });
  }
  return acc;
}
const files = walk(OUT);
const total = files.reduce((n, f) => n + f.size, 0);
console.log(`output: ${OUT}`);
console.log(`files: ${files.length}`);
console.log(`totalBytes: ${total}`);
