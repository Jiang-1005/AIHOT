// When a community post went up, as the 社区热帖 list and reader show it (Beijing time).

/** A timestamp kept with its date only (小红书 and other posts collected without a time): T00:00:00. */
const DATE_ONLY = /T00:00:00(?:\.0+)?(?:Z|[+-]\d{2}:?\d{2})?$/;

/** Beijing date and time of a post as written in its timestamp (all carry +08:00); null when unreadable. */
function beijingParts(iso: string): { y: number; m: number; d: number; hm: string } | null {
  const local = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (local && /\+08:?00$/.test(iso)) return { y: +local[1], m: +local[2], d: +local[3], hm: `${local[4]}:${local[5]}` };
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const b = new Date(t + 8 * 3600_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return { y: b.getUTCFullYear(), m: b.getUTCMonth() + 1, d: b.getUTCDate(), hm: `${pad(b.getUTCHours())}:${pad(b.getUTCMinutes())}` };
}

/**
 * When a post went up. Posts collected with only a date (小红书 and others stored as T00:00:00) show the
 * date alone, never "00:00"; posts with a real time (X) show it to the minute.
 */
export function formatWhen(item: { day: string | null; published_at: string | null }, today: string, long = false): string {
  const published = item.published_at || "";
  const dateOnly = !published || DATE_ONLY.test(published);
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
  return new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
}

