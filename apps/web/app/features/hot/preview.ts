import type { HotResponse } from "@aihot/contracts/site";
import { hotPreviewFixture, hotPreviewFallback } from "./fixtures/preview-data";
import type { Fallback } from "./presentation";

/** Preview pages (Vercel preview, or HOT_PREVIEW_FIXTURE=1) may serve a local export instead of Neon. */
export function previewEnabled(): boolean {
  return process.env.HOT_PREVIEW_FIXTURE === "1" || process.env.VERCEL_ENV === "preview";
}

function hoursAgoIso(hours: number, now = Date.now()): string {
  return new Date(now - hours * 3_600_000).toISOString();
}

export function applyPreview(hot: HotResponse, state: string | null, now = Date.now()): { hot: HotResponse; usingFixture: boolean } {
  if (!previewEnabled()) return { hot, usingFixture: false };
  const list = hotPreviewFixture();
  if (state === "empty") return { hot: { computedAt: hoursAgoIso(1, now), windowHours: 48, entries: [] }, usingFixture: true };
  if (state === "stale-empty") return { hot: { computedAt: hoursAgoIso(14, now), windowHours: 48, entries: [] }, usingFixture: true };
  if (state === "stale") return { hot: { ...list, computedAt: hoursAgoIso(14, now) }, usingFixture: true };
  // Default preview: when Neon is empty or the reviewer asks for the fixture, show the local export as a fresh list.
  if (state === "fixture" || hot.entries.length === 0) {
    return { hot: { ...list, computedAt: hoursAgoIso(1, now) }, usingFixture: true };
  }
  return { hot, usingFixture: false };
}

export function previewFallback(): Fallback {
  return hotPreviewFallback();
}
