// Model and catalog output → the stored five dimensions. Failure cases: a made-up value, an 「｜推断」 suffix,
// a platform or file name counted as a company, one company under two spellings.
import assert from "node:assert/strict";
import { test } from "node:test";
import { companyName, companySpellings, facetsEmpty, HEAD_COMPANIES, parseItemFacets } from "@aihot/contracts/facets";

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

test("one company under its Chinese and English names is one chip", () => {
  // 11-17 dry-run: the same 读卖 article came back once as 倍乐生 and once as Benesse.
  assert.deepEqual(parseItemFacets({ companies: ["Benesse", "倍乐生", "ベネッセ › 进研ゼミ"] }).companies, ["Benesse（倍乐生）", "进研ゼミ"]);
  assert.deepEqual(parseItemFacets({ companies: ["Microsoft", "微软"] }).companies, ["Microsoft（微软）"]);
  for (const [spellings, chip] of [
    [["Google", "谷歌", "google"], "Google"],
    [["OpenAI", "Open AI", "OPENAI"], "OpenAI"],
    [["Khan Academy", "可汗学院", "khan academy", "Khan", "Khan Academy（可汗学院）"], "Khan Academy（可汗学院）"],
    [["Duolingo", "多邻国", "Duolingo（多邻国）"], "Duolingo（多邻国）"],
    [["字节跳动", "ByteDance"], "字节跳动"],
    [["阿里", "阿里巴巴", "Alibaba"], "阿里"],
    [["腾讯", "Tencent"], "腾讯"],
    [["松鼠Ai", "松鼠AI"], "松鼠Ai"],
  ] as const) {
    for (const s of spellings) assert.equal(companyName(s), chip, s);
  }
  // A product keeps its own chip.
  assert.equal(companyName("Google Classroom"), "Google Classroom");
  assert.equal(companyName("Khanmigo"), "Khanmigo");
});

test("chip names: English only when parents know it in English, 「英文（中文）」 when they mostly know the Chinese", () => {
  // The design data (data/facets.json) and the 精选 catalog still say "Khan Academy"; reading them gives the new chip.
  assert.deepEqual(parseItemFacets({ companies: ["Khan Academy", "可汗学院 › Khanmigo"] }).companies, ["Khan Academy（可汗学院）", "Khanmigo"]);
  assert.ok(HEAD_COMPANIES.includes("Khan Academy（可汗学院）"));
  assert.ok(!(HEAD_COMPANIES as readonly string[]).includes("Khan Academy"));
  for (const chip of ["Google", "OpenAI", "Apple", "Microsoft（微软）", "Duolingo（多邻国）", "Benesse（倍乐生）"]) assert.equal(companyName(chip), chip);
  // A filter on the chip still finds rows stored under the old name.
  assert.ok(companySpellings("Khan Academy").includes("Khan Academy"));
  assert.equal(companySpellings("Khan Academy")[0], "Khan Academy（可汗学院）");
});
