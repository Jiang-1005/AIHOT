// The event page's「全部来源」rail: one row per editorial source, each with its original article URL.
import { publicSourceName } from "./rules.ts";

export interface StorySourceRow {
  name: string;
  itemId: string;
  publishedAt: string;
  /** The report's original article (publications.url); null when it is missing or not http(s). */
  url: string | null;
}

export interface StorySourceInput {
  id: string;
  url: string | null;
  selected: boolean;
  at: Date;
  source_id: string;
  source_name: string;
}

function originalUrl(raw: string | null | undefined): string | null {
  const url = (raw ?? "").trim();
  return /^https?:\/\/[^\s]+$/i.test(url) ? url : null;
}

/**
 * One row per source, not sliced. The link is that source's selected report first, then its latest;
 * a report with an original URL wins over one without, so a row only lacks a URL when the source has none.
 */
export function sourcesOf(reports: readonly StorySourceInput[]): StorySourceRow[] {
  const ranked = [...reports].sort(
    (a, b) =>
      Number(Boolean(originalUrl(b.url))) - Number(Boolean(originalUrl(a.url))) ||
      Number(b.selected) - Number(a.selected) ||
      b.at.getTime() - a.at.getTime() ||
      a.id.localeCompare(b.id),
  );
  const seen = new Map<string, StorySourceRow>();
  for (const r of ranked) {
    const key = r.source_id || r.source_name;
    if (seen.has(key)) continue;
    seen.set(key, { name: publicSourceName(r.source_name), itemId: r.id, publishedAt: r.at.toISOString(), url: originalUrl(r.url) });
  }
  // Rail order: the most recent report first, as before.
  return [...seen.values()].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || a.name.localeCompare(b.name));
}
