import { beijingDate, beijingTime, beijingWeekday, monthDay as engineMonthDay } from "@aihot/contracts/time";

/**
 * "9月28日" of a calendar date (YYYY-MM-DD). A day of another year than `now` (Beijing) carries its year, so an
 * archived item is not read as this year's: "2019年2月19日". The engine's monthDay does this only when given today.
 */
export function monthDay(date: string, now: number = Date.now()): string {
  return engineMonthDay(date, beijingDate(now));
}

/** A list cut into runs of the same Beijing day, in the list's own order. */
export function byBeijingDay<T>(list: readonly T[], at: (entry: T) => string): Array<{ day: string; entries: T[] }> {
  const days: Array<{ day: string; entries: T[] }> = [];
  for (const entry of list) {
    const day = beijingDate(at(entry));
    const last = days.at(-1);
    if (last?.day === day) last.entries.push(entry);
    else days.push({ day, entries: [entry] });
  }
  return days;
}

/** "周六" of a calendar date (YYYY-MM-DD). */
export function weekdayShort(date: string): string {
  return beijingWeekday(date).replace("星期", "周");
}

export function relativeTime(iso: string, now = Date.now()): string {
  return timeAgo(iso, now) ?? beijingDate(iso);
}

/**
 * A report known only by its date is stored at Beijing midnight to the second (T00:00:00+08:00); it has no
 * clock, so it shows no 00:00 (as on the lists, Timeline slotClock).
 */
export function isDateOnly(iso: string): boolean {
  const t = Date.parse(iso);
  return Number.isFinite(t) && t % 60_000 === 0 && beijingTime(iso) === "00:00";
}

/** Whole Beijing calendar days from `iso`'s day to `now`'s. */
function beijingDaysBetween(iso: string, now: number): number {
  return Math.round((Date.parse(beijingDate(now)) - Date.parse(beijingDate(iso))) / 86_400_000);
}

/**
 * "3 天前" while that is under a month, else null: beside a full time, the date it would fall back to says nothing new.
 * A date without a time counts Beijing calendar days (今天, 昨天, 2 天前), not hours since a made-up midnight.
 */
export function timeAgo(iso: string, now = Date.now()): string | null {
  if (isDateOnly(iso)) {
    const days = Math.max(0, beijingDaysBetween(iso, now));
    return days === 0 ? "今天" : days === 1 ? "昨天" : days < 30 ? `${days} 天前` : null;
  }
  const t = Date.parse(iso);
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "刚刚";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} 分钟前`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.round(h / 24);
  return d < 30 ? `${d} 天前` : null;
}

/** "2026-11-13 09:40" (Beijing), or the date alone for a report known only by its date. */
export function fullDateTime(iso: string): string {
  return isDateOnly(iso) ? beijingDate(iso) : `${beijingDate(iso)} ${beijingTime(iso)}`;
}

/** "9月24日 10:51" (Beijing), for lists that span days. */
export function monthDayTime(iso: string): string {
  return `${monthDay(beijingDate(iso))} ${beijingTime(iso)}`;
}

export function sourceInitial(name: string): string {
  const s = name.replace(/^[^\p{L}\p{N}]+/u, "");
  return (s[0] ?? "A").toUpperCase();
}
