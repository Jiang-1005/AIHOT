// A Vercel preview cannot reach the local database the hot board is re-ranked in, so scripts/export-hot-preview.ts
// writes the recomputed /api/site/hot answer to site/preview/hot.json and the preview's api serves that file.
// Production and local never read it.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { HotResponse } from "@aihot/contracts/site";
import { REPO_ROOT } from "../config.ts";

export const HOT_PREVIEW_FILE = path.join(REPO_ROOT, "site/preview/hot.json");

export function previewHotSnapshot(env: Record<string, string | undefined> = process.env, file = HOT_PREVIEW_FILE): HotResponse | null {
  if (env.VERCEL_ENV !== "preview" || !existsSync(file)) return null;
  const hot = JSON.parse(readFileSync(file, "utf8")) as HotResponse;
  return Array.isArray(hot.entries) ? hot : null;
}
