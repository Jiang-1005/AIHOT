// When a community post went up, as the 社区热帖 list and reader show it (Beijing time).
import { beijingDate, beijingTime } from "@aihot/contracts/time";

/** A calendar day with no clock: `YYYY-MM-DD`, or a midnight stamp that was stored only to fill a timestamp. */
const BARE_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_ONLY = /T00:00:00(?:\.0+)?(?:Z|[+-]\d{2}:?\d{2})?$/;

/** Beijing date and time of a post as written in its timestamp; null when unreadable. A bare day has no clock. */
function beijingParts(iso: string): { y: number; m: number; d: number; hm: string } | null {
  const bare = BARE_DAY.exec(iso);
  if (bare) return { y: +bare[1]!, m: +bare[2]!, d: +bare[3]!, hm: "" };
  const local = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (local && /\+08:?00$/.test(iso)) return { y: +local[1], m: +local[2], d: +local[3], hm: `${local[4]}:${local[5]}` };
  if (DATE_ONLY.test(iso)) {
    const day = iso.slice(0, 10);
    const parts = BARE_DAY.exec(day);
    if (parts) return { y: +parts[1]!, m: +parts[2]!, d: +parts[3]!, hm: "" };
  }
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const [y, m, d] = beijingDate(t).split("-").map(Number) as [number, number, number];
  return { y, m, d, hm: beijingTime(t) };
}

/**
 * When a post went up. A bare `YYYY-MM-DD` or a `T00:00:00` stamp is only a date: never "08:00" or
 * "00:00". A real time shows to the minute. No date stays blank.
 */
export function formatWhen(item: { day: string | null; published_at: string | null }, today: string, long = false): string {
  const published = item.published_at || "";
  const dateOnly = !published || BARE_DAY.test(published) || DATE_ONLY.test(published);
  const parts = published ? beijingParts(published) : null;
  const dayRaw = item.day || (parts ? `${parts.y}-${String(parts.m).padStart(2, "0")}-${String(parts.d).padStart(2, "0")}` : "");
  const dm = dayRaw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!dm) return "";
  const yesterday = shiftDay(today, -1);
  const label = long
    ? `${Number(dm[1])} 年 ${Number(dm[2])} 月 ${Number(dm[3])} 日`
    : dayRaw === today ? "今天" : dayRaw === yesterday ? "昨天" : `${Number(dm[2])} 月 ${Number(dm[3])} 日`;
  if (dateOnly || !parts) return label;
  return `${label} ${parts.hm}`;
}

function shiftDay(day: string, by: number): string {
  const t = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(t)) return "";
  return new Date(t + by * 86400_000).toISOString().slice(0, 10);
}

export function beijingToday(): string {
  return beijingDate(Date.now());
}

