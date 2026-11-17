/** Presentation helpers for /hot: freshness, source line, absolute time with timezone. */
import { beijingDate, monthDay, beijingTime } from "@aihot/contracts/time";

/** Same wording as the list helper monthDayTime, with the year when the day is not this year in Beijing. */
function monthDayTime(iso: string, now = Date.now()): string {
  return `${monthDay(beijingDate(iso), beijingDate(now))} ${beijingTime(iso)}`;
}

/** One import round: list older than this drops「实时热度」and shows an expiration notice. */
export const STALE_AFTER_MS = 13 * 60 * 60 * 1000;

export function isStale(computedAt: string | null | undefined, now = Date.now()): boolean {
  if (!computedAt) return true;
  const t = Date.parse(computedAt);
  return !Number.isFinite(t) || now - t > STALE_AFTER_MS;
}

/** 「11月17日 13:10 更新（北京时间）」for the page header when the list is fresh. */
export function updatedAtLabel(iso: string): string {
  return `${monthDayTime(iso)} 更新（北京时间）`;
}

/** 「11月14日 20:40（北京时间）」used in expiration copy, without「更新」. */
export function computedAtBeijing(iso: string): string {
  return `${monthDayTime(iso)}（北京时间）`;
}

export type EmptyKind = "stale" | "empty";

/** Empty list: expired/recomputing vs this window had nothing to rank. */
export function emptyKind(computedAt: string | null | undefined, now = Date.now()): EmptyKind {
  return isStale(computedAt, now) ? "stale" : "empty";
}

/**
 * 「芥末堆 · 1 个来源」; 「芥末堆、光明日报 · 2 个来源」;
 * three names plus「N 个来源」; four or more: first three +「等 N 个来源」.
 */
export function sourceLine(sourceCount: number, sourceNames: readonly string[]): string {
  const names = sourceNames.filter(Boolean);
  const count = Math.max(sourceCount, names.length, 0);
  if (count <= 1) return names[0] ? `${names[0]} · 1 个来源` : "1 个来源";
  const shown = names.slice(0, 3);
  if (!shown.length) return `${count} 个来源`;
  if (count > shown.length) return `${shown.join("、")} 等 ${count} 个来源`;
  return `${shown.join("、")} · ${count} 个来源`;
}

/** sourceLine split so the count (「1 个来源」「等 5 个来源」) can be kept on one line: [names, count]. */
export function sourceLineParts(sourceCount: number, sourceNames: readonly string[]): [string, string] {
  const line = sourceLine(sourceCount, sourceNames);
  const m = /^(.*?)((?: · | 等 )?\d+ 个来源)$/.exec(line);
  return m ? [m[1]!, m[2]!] : ["", line];
}

export type FallbackItem = { id: string; title: string; sourceName: string; at: string; selected: boolean };
export type Fallback = { kind: "featured" | "latest"; items: FallbackItem[] } | null;
