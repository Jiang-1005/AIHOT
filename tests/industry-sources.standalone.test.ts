import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { unsupportedConfig } from "@aihot/backend/sources/config-keys";
import { noiseFiltered } from "@aihot/backend/sources/filters";
import { validateSourceCatalog } from "../scripts/verify-sources-live.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("industry/sources.json passes config validation and includes expanded verified sources", () => {
  const catalog = JSON.parse(readFileSync(path.join(ROOT, "industry", "sources.json"), "utf8"));
  assert.ok(Array.isArray(catalog.sources));
  assert.ok(catalog.sources.length >= 45, `expected >= 45 sources, got ${catalog.sources.length}`);

  const errors = validateSourceCatalog(catalog);
  assert.deepEqual(errors, []);

  for (const s of catalog.sources) {
    assert.deepEqual(unsupportedConfig(s.kind, s.config ?? {}), [], `unsupported config on ${s.id}`);
  }
});

test("general tech feeds filter out non-education noise while keeping education AI items", () => {
  const catalog = JSON.parse(readFileSync(path.join(ROOT, "industry", "sources.json"), "utf8"));
  const qbitai = catalog.sources.find((s: { id: string }) => s.id === "rss-qbitai");
  assert.ok(qbitai);
  assert.equal(
    noiseFiltered({ url: "https://example.com/1", title: "华为云具身智能机器人发布", excerpt: "工业流水线实测展示。" } as never, qbitai),
    true,
  );
  assert.equal(
    noiseFiltered({ url: "https://example.com/2", title: "学而思发布新一代九章大模型学习机", excerpt: "面向中小学个性化伴学场景。" } as never, qbitai),
    false,
  );

  const arxiv = catalog.sources.find((s: { id: string }) => s.id === "rss-arxiv-cy");
  assert.ok(arxiv);
  assert.equal(
    noiseFiltered({ url: "https://arxiv.org/abs/1", title: "Blockchain Governance in Supply Chains", excerpt: "A survey of consensus protocols." } as never, arxiv),
    true,
  );
  assert.equal(
    noiseFiltered({ url: "https://arxiv.org/abs/2", title: "Evaluating LLM Tutoring Systems in K-12 Classrooms", excerpt: "Student learning outcomes improved." } as never, arxiv),
    false,
  );
});

test("industry/sources.wechat.example.json entries are valid mp_account templates", () => {
  const tpl = JSON.parse(readFileSync(path.join(ROOT, "industry", "sources.wechat.example.json"), "utf8"));
  assert.ok(Array.isArray(tpl.sources));
  assert.ok(tpl.sources.length >= 15);
  for (const s of tpl.sources) {
    assert.equal(s.kind, "mp_account");
    assert.deepEqual(unsupportedConfig(s.kind, s.config ?? {}), [], `unsupported config on ${s.id}`);
  }
});
