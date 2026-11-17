// Headline word groups for WordTitle (components/ui/WordTitle.tsx).
const HAN = /^[\u4e00-\u9fff]+$/;
/** Longest run kept on one line; past this the title may break inside the group. */
const MAX_GROUP = 6;

/**
 * Split text into pieces, marking the runs of Chinese to keep unbroken. A one-character word joins the word
 * before it (未成年+人), or the next one when it opens a run (新+学期), within MAX_GROUP characters.
 */
export function titleWords(text: string, segmenter: Intl.Segmenter): { text: string; keep: boolean }[] {
  const out: { text: string; keep: boolean }[] = [];
  let carry = "";
  const flush = () => { if (carry) { out.push({ text: carry, keep: carry.length > 1 }); carry = ""; } };
  for (const { segment } of segmenter.segment(text)) {
    if (!HAN.test(segment)) { flush(); out.push({ text: segment, keep: false }); continue; }
    const last = out[out.length - 1];
    const lastHan = !carry && last !== undefined && HAN.test(last.text);
    if (segment.length === 1 && lastHan && last.text.length < MAX_GROUP) { last.text += segment; last.keep = true; continue; }
    if (segment.length === 1 && !lastHan) { carry += segment; if (carry.length >= MAX_GROUP) flush(); continue; }
    const word = carry + segment;
    carry = "";
    out.push({ text: word, keep: word.length > 1 && word.length <= MAX_GROUP });
  }
  flush();
  return out;
}
