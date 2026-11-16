/** Strip internal product-name mentions from text shown on public pages. */
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
