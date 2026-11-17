// Model and catalog output → the stored five dimensions. Failure cases: a made-up value, an 「｜推断」 suffix,
// a platform or file name counted as a company, one company under two spellings.
import assert from "node:assert/strict";
import { test } from "node:test";
import { facetsEmpty, parseItemFacets } from "@aihot/contracts/facets";

test("values outside the lists become null and companies become chip names", () => {
  assert.deepEqual(parseItemFacets({
    topic: "政策与合规｜推断", subject: "数学", form: "AI玩具与陪伴设备", contentType: "研究报告",
    companies: ["猿辅导 › 小猿", "小红书", "不涉及 › 某品牌", "科大讯飞", "讯飞", "Duolingo", "多邻国", "my-skill-file", 3],
  }), {
    topic: "政策与合规", subject: null, form: "AI玩具与陪伴设备", content_type: "研究报告",
    companies: ["猿辅导", "小猿", "讯飞", "Duolingo（多邻国）"],
  });
});

test("nothing usable is empty", () => {
  assert.ok(facetsEmpty(parseItemFacets({ topic: "待定", companies: ["X"] })));
  assert.ok(facetsEmpty(parseItemFacets(null)));
});
