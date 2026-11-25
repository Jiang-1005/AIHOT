// Original publication day of an editor-written brief dateline.
// 原发日 is the real calendar day the cell starts with. A clock or a parenthetical note is evidence
// and does not move that day. 发现日 (discovered_at) and 导入日 (the brief file's date) are not read here.
import { beijingMidnight, isValidDate } from "@aihot/contracts/time";

/**
 * The check this importer used before annotated datelines were accepted: the whole cell had to be
 * exactly YYYY-MM-DD. A time or a note failed it. An impossible day such as 2026-02-30 matched it.
 */
export const LEGACY_EXACT_DATELINE = /^\d{4}-\d{2}-\d{2}$/;

// Leading real day, optional " HH:mm[:ss][zone]", optional one note in （） or ().
// "T" is not a separator: YYYY-MM-DDT... is an ISO instant and is left to the timestamp reader,
// so a UTC instant is not relabelled as the UTC calendar day.
const DATELINE = /^(\d{4}-\d{2}-\d{2})(?: ([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?(?:Z|[+-](?:[01]\d|2[0-3]):?[0-5]\d)?)?(?:（[^）]*）|\([^)]*\))?$/;

export interface OriginalDateline {
  /** 原发日, YYYY-MM-DD. */
  day: string;
  /** 00:00 Asia/Shanghai on that day. The clock in the cell is not this instant. */
  publishedAt: Date;
  /** Trimmed cell, unchanged. */
  evidence: string;
}

/** The original publication day of a brief cell, or null when it is empty, not a dateline, or not a real day. */
export function parseOriginalDateline(raw: string | null | undefined): OriginalDateline | null {
  const evidence = (raw ?? "").trim();
  if (!evidence) return null;
  const match = DATELINE.exec(evidence);
  if (!match) return null;
  const day = match[1]!;
  if (!isValidDate(day)) return null;
  return { day, publishedAt: beijingMidnight(day), evidence };
}
