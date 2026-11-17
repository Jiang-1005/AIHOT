import type { HotResponse } from "@aihot/contracts/site";

/** Preview pages (Vercel preview, or HOT_PREVIEW_FIXTURE=1) accept ?state= to show the board's other states. */
export function previewEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.HOT_PREVIEW_FIXTURE === "1" || env.VERCEL_ENV === "preview";
}

export const DEMO_STATES = ["empty", "stale", "stale-empty"] as const;
export type DemoState = (typeof DEMO_STATES)[number];

export function demoState(raw: string | null): DemoState | null {
  return (DEMO_STATES as readonly string[]).includes(raw ?? "") ? (raw as DemoState) : null;
}

function hoursAgoIso(hours: number, now: number): string {
  return new Date(now - hours * 3_600_000).toISOString();
}

/**
 * The real /api/site/hot answer, except for the three demo states: empty (fresh, nothing ranked),
 * stale (the real list, its time pushed back 14 hours) and stale-empty (expired and empty).
 */
export function applyDemoState(hot: HotResponse, state: DemoState | null, now = Date.now()): HotResponse {
  if (state === "empty") return { computedAt: hoursAgoIso(1, now), windowHours: hot.windowHours, entries: [] };
  if (state === "stale-empty") return { computedAt: hoursAgoIso(14, now), windowHours: hot.windowHours, entries: [] };
  if (state === "stale") return { ...hot, computedAt: hoursAgoIso(14, now) };
  return hot;
}
