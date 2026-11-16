/** Strip internal product-name mentions from any public-facing text. */
export function publicCopy(text: string | null | undefined): string {
  if (!text) return "";
  let s = text
    .replace(/与心田花开(产品)?(的)?(直接)?相关[：:]?/g, "")
    .replace(/心田花开(团队)?/g, "")
    .replace(/心田/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/是谈「/g, "是讨论「")
    .replace(/可与\s*「/g, "可与「")
    .replace(/对照\s*「/g, "对照「")
    .replace(/与\s*「/g, "与「")
    .replace(/，{2,}/g, "，")
    .replace(/^[-—、，。\s]+/, "")
    .trim();
  return s;
}

/** Like publicCopy, but empty after scrub becomes null. */
export function publicText(text: string | null | undefined): string | null {
  const s = publicCopy(text);
  return s === "" ? null : s;
}

const HIDDEN_TAGS = new Set(["心田花开", "心田", "xintian", "xintianhuaikai"]);

export function publicTags(tags: string[] | null | undefined): string[] {
  if (!tags?.length) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of tags) {
    if (HIDDEN_TAGS.has(raw.trim())) continue;
    const t = publicCopy(raw);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** Keys that must never appear in a public JSON payload, even if a stored row still has them. */
const INTERNAL_KEYS = new Set([
  "与心田花开相关",
  "xintianRelevance",
  "xintianRelevanceReason",
  "xintian_relevance",
  "relevance_xintian",
  "why_xintian",
  "whyXintian",
  "internalNotes",
  "internal_notes",
  "internalNote",
  "internal_note",
]);

export function isInternalPublicKey(key: string): boolean {
  return INTERNAL_KEYS.has(key);
}
