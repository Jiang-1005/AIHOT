// The five dimensions every report is tagged with (taxonomy.md, 2026-11-10): four single choices from a
// fixed list and the companies it is about. The site filters 精选 by them; the analysis writes them.

export const FACET_VOCAB = {
  topic: ["公司与资本", "产品与功能", "政策与合规", "研究与证据", "教学实践", "观点与趋势"],
  subject: ["表达与口语", "阅读写作", "绘本伴读", "情商与SEL", "英语", "数理与提分", "全科通用", "不涉及"],
  form: ["App与网页", "大模型学习模式", "教师工具与平台", "学习机与平板", "词典笔与点读绘本机", "AI玩具与陪伴设备", "服务（线下或真人+AI）", "不涉及"],
  content_type: ["新闻快讯", "官方发布", "深度分析", "测评体验", "研究报告", "观点评论", "教程与提示词", "用户自述"],
} as const;

export type SingleFacet = keyof typeof FACET_VOCAB;
export const SINGLE_FACETS = Object.keys(FACET_VOCAB) as SingleFacet[];

export const HEAD_COMPANIES = [
  "好未来", "学而思", "新东方", "猿辅导", "作业帮", "有道", "讯飞", "高途", "豆神", "洋葱学园", "叫叫",
  "Duolingo（多邻国）", "Khan Academy（可汗学院）", "Chegg", "Quizlet", "Speak",
] as const;

/** A report's five dimensions as the public API returns them. A single choice the model could not make is null. */
export interface ItemFacets {
  topic: (typeof FACET_VOCAB.topic)[number] | null;
  subject: (typeof FACET_VOCAB.subject)[number] | null;
  form: (typeof FACET_VOCAB.form)[number] | null;
  content_type: (typeof FACET_VOCAB.content_type)[number] | null;
  /** 公司与产品 chip names, companies and their brands (「公司 › 品牌」 gives both). */
  companies: string[];
}

/** "政策与合规｜推断" → "政策与合规". */
export function baseLabel(value: string | null | undefined): string {
  if (!value) return "";
  return String(value).split("｜")[0]!.trim();
}

const NOT_A_COMPANY = new Set(["", "不涉及", "未查到", "待定", "小红书", "X", "心田花开", "心田"]);
// One company under two spellings is one chip. Chip names (体验大师, 2026-11-17): a name parents know in
// English is written in English only (Google, OpenAI, Apple); one used in both languages that parents mostly
// know in Chinese is 「英文（中文）」 (Duolingo（多邻国）, Khan Academy（可汗学院）, Microsoft（微软）, Benesse（倍乐生）).
// Chinese companies keep their Chinese name. Products (Google Classroom, Khanmigo, 豆包) stay their own chips.
const ALIASES: Record<string, readonly string[]> = {
  有道: ["网易有道", "Youdao", "NetEase Youdao"],
  讯飞: ["科大讯飞", "iFlytek", "iFLYTEK"],
  豆神: ["豆神教育"],
  好未来: ["TAL", "TAL Education"],
  新东方: ["New Oriental"],
  作业帮: ["Zuoyebang"],
  猿辅导: ["Yuanfudao"],
  "Khan Academy（可汗学院）": ["Khan Academy", "Khan", "可汗学院", "可汗"],
  "Duolingo（多邻国）": ["Duolingo", "多邻国"],
  "Benesse（倍乐生）": ["Benesse", "倍乐生", "ベネッセ", "Benesse Corporation", "Benesse Holdings"],
  "Microsoft（微软）": ["Microsoft", "微软", "Microsoft Corporation"],
  Google: ["谷歌", "Google LLC", "Alphabet"],
  OpenAI: ["Open AI"],
  Apple: ["苹果", "苹果公司"],
  Amazon: ["亚马逊"],
  NVIDIA: ["英伟达", "Nvidia"],
  DeepSeek: ["深度求索"],
  阿里: ["阿里巴巴", "Alibaba", "阿里巴巴集团"],
  字节跳动: ["ByteDance", "字节"],
  腾讯: ["Tencent"],
  百度: ["Baidu"],
  华为: ["Huawei"],
  月之暗面: ["Moonshot AI"],
  智谱: ["Zhipu", "智谱AI", "Zhipu AI"],
  松鼠Ai: ["松鼠AI", "Squirrel AI"],
};
/** Case and spacing do not make a second company: "OPENAI", "Open AI" and "openai" are one. */
const fold = (name: string) => name.toLowerCase().replace(/\s+/g, "");
const DISPLAY_NAME = new Map(Object.entries(ALIASES).flatMap(([chip, names]) => [chip, ...names].map((n) => [fold(n), chip] as const)));

/** Every stored spelling of a chip, so rows written under an older chip name still match its filter. */
export function companySpellings(chip: string): string[] {
  const c = companyName(chip);
  if (c === null) return [];
  return [c, ...(ALIASES[c] ?? [])];
}

/** One name of a 公司与产品 token as its chip shows it; null for a platform, a placeholder or a file/skill name. */
export function companyName(name: string): string | null {
  const n = String(name ?? "").trim();
  if (NOT_A_COMPANY.has(n) || /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+$/.test(n)) return null;
  return DISPLAY_NAME.get(fold(n)) ?? n;
}

/** Every chip a token stands for: 「好未来 › 学而思」 is found under both 好未来 and 学而思. */
export function companyNames(token: string): string[] {
  const parts = String(token ?? "").split(/\s*[›>／/]\s*/);
  // A placeholder company hides its brands too ("不涉及 › …").
  if (companyName(parts[0] ?? "") === null) return [];
  return [...new Set(parts.flatMap((p) => { const n = companyName(p); return n && n.length <= 60 ? [n] : []; }))];
}

function single<K extends SingleFacet>(key: K, value: unknown): ItemFacets[K] {
  const label = baseLabel(typeof value === "string" ? value : null);
  return ((FACET_VOCAB[key] as readonly string[]).includes(label) ? label : null) as ItemFacets[K];
}

/** Model or catalog output → the stored shape: values outside the lists become null, companies are deduplicated chip names. */
export function parseItemFacets(raw: Record<string, unknown> | null | undefined): ItemFacets {
  const r = raw ?? {};
  const tokens = Array.isArray(r.companies) ? r.companies : [];
  const companies = [...new Set(tokens.flatMap((t) => (typeof t === "string" ? companyNames(t) : [])))].slice(0, 12);
  return {
    topic: single("topic", r.topic),
    subject: single("subject", r.subject),
    form: single("form", r.form),
    content_type: single("content_type", r.content_type ?? r.contentType),
    companies,
  };
}

/** True when the model gave none of the five. */
export function facetsEmpty(f: ItemFacets): boolean {
  return !f.topic && !f.subject && !f.form && !f.content_type && !f.companies.length;
}
