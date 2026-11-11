/**
 * Terms this site never shows on public pages (for example an internal team or product name that slipped
 * into a model-written summary). Empty by default: list them here, longest first, when your site needs it.
 */
export const HIDDEN_PUBLIC_TERMS: readonly string[] = [];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const HIDDEN_RE = HIDDEN_PUBLIC_TERMS.length
  ? new RegExp(HIDDEN_PUBLIC_TERMS.map(escapeRegExp).join("|"), "g")
  : null;

/** Strip the site's hidden terms from any public-facing text. */
export function publicCopy(text: string | null | undefined): string {
  if (!text) return "";
  if (!HIDDEN_RE) return text.trim();
  return text
    .replace(HIDDEN_RE, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/，{2,}/g, "，")
    .replace(/^[-—、，。\s]+/, "")
    .trim();
}

/** Like publicCopy, but empty after scrub becomes null. */
export function publicText(text: string | null | undefined): string | null {
  const s = publicCopy(text);
  return s === "" ? null : s;
}

const HIDDEN_TAGS = new Set(HIDDEN_PUBLIC_TERMS);

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
  "focusRelevance",
  "focusRelevanceReason",
  "internalNotes",
  "internal_notes",
  "internalNote",
  "internal_note",
]);

export function isInternalPublicKey(key: string): boolean {
  return INTERNAL_KEYS.has(key);
}
