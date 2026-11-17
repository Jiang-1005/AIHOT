// Text in the chosen looks: headlines break between words (未成年|人, 健康|第|一 are rejoined) and look names fit the sidebar picker.
import assert from "node:assert/strict";
import { test } from "node:test";
import { titleWords } from "../app/lib/title-words.ts";

const seg = new Intl.Segmenter("zh", { granularity: "word" });
const kept = (t: string) => titleWords(t, seg).filter((w) => w.keep).map((w) => w.text);

test("a one-character piece joins its neighbour, so no headline breaks inside a word", () => {
  assert.ok(kept("警惕未成年人AI过度依赖").includes("未成年人"));
  assert.ok(kept("健康第一").some((w) => w.includes("第一")) && !kept("健康第一").includes("第"));
});

test("the pieces put back together are the headline, and no kept group is longer than six characters", () => {
  for (const t of ["警惕未成年人AI过度依赖", "路透调查中国推动AI原生一代：北京新英才学校自建AI课程与课堂模型", "我和你", "AI 时代的作文课"]) {
    const words = titleWords(t, seg);
    assert.equal(words.map((w) => w.text).join(""), t);
    assert.ok(words.every((w) => !w.keep || w.text.length <= 6), JSON.stringify(words));
  }
});

test("every look's name fits the sidebar picker: 外观： plus at most four characters", async () => {
  const { SITE_STYLES, shortLabel } = await import("../app/lib/site-styles.ts");
  for (const s of SITE_STYLES) assert.ok(`外观：${shortLabel(s)}`.length <= 7, s.id);
});
