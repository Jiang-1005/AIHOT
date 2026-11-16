import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { isMissingRelation } from "@aihot/backend/publication/site-blobs";
import { readVoicesCatalogFile, VoicesCatalogUnavailable } from "@aihot/backend/publication/voices";

function emptyCatalog() {
  return {
    generatedAt: "2026-11-16T00:00:00+08:00",
    asOf: "2026-11-16",
    section: "社区热帖",
    items: [],
    counts: { featured: 0, archive: 0, total: 0 },
    report: {},
  };
}

test("readVoicesCatalogFile returns a valid catalog, including a genuine empty list", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "voices-cat-"));
  const file = path.join(dir, "voices.json");
  try {
    const empty = emptyCatalog();
    writeFileSync(file, JSON.stringify(empty));
    const got = readVoicesCatalogFile(file);
    assert.equal(got.items.length, 0);
    assert.equal(got.generatedAt, empty.generatedAt);
    writeFileSync(file, JSON.stringify({ ...empty, items: [{ id: "a" }, { id: "b" }] }));
    assert.equal(readVoicesCatalogFile(file).items.length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readVoicesCatalogFile throws when the file is missing, invalid, or has no items array", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "voices-cat-"));
  const missing = path.join(dir, "missing.json");
  const bad = path.join(dir, "bad.json");
  const noItems = path.join(dir, "no-items.json");
  try {
    writeFileSync(bad, "{not json");
    writeFileSync(noItems, JSON.stringify({ generatedAt: "", asOf: "" }));
    assert.throws(() => readVoicesCatalogFile(missing), VoicesCatalogUnavailable);
    assert.throws(() => readVoicesCatalogFile(bad), VoicesCatalogUnavailable);
    assert.throws(() => readVoicesCatalogFile(noItems), VoicesCatalogUnavailable);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("isMissingRelation is true only for Postgres undefined_table", () => {
  assert.equal(isMissingRelation({ code: "42P01" }), true);
  assert.equal(isMissingRelation({ code: "ECONNREFUSED" }), false);
  assert.equal(isMissingRelation(new Error("connect")), false);
  assert.equal(isMissingRelation(null), false);
});
