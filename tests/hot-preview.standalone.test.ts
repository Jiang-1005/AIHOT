import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { previewHotSnapshot } from "@aihot/backend/publication/hot-preview";

const file = path.join(mkdtempSync(path.join(tmpdir(), "hot-preview-")), "hot.json");
writeFileSync(file, JSON.stringify({ computedAt: "2026-11-17T06:28:11.334Z", windowHours: 48, entries: [{ rank: 1 }] }));

test("previewHotSnapshot: served only on a Vercel preview with an exported file", () => {
  assert.equal(previewHotSnapshot({ VERCEL_ENV: "preview" }, file)?.entries.length, 1);
  assert.equal(previewHotSnapshot({ VERCEL_ENV: "production" }, file), null);
  assert.equal(previewHotSnapshot({}, file), null);
  assert.equal(previewHotSnapshot({ VERCEL_ENV: "preview" }, file + ".missing"), null);
});
