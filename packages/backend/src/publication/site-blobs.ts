// Catalog files (voices, content-tags) live on disk in Docker and in this table on Vercel / Neon.
// Readers still use the data directory; this module hydrates it from the database when the file is
// missing, and on Vercel refreshes it when site_blobs.updated_at is newer than the local sidecar.
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { sql } from "../db.ts";
import { config } from "../config.ts";

export const SITE_BLOB_FILES = {
  voices: "voices.json",
  "content-tags": "content-tags.json",
  // Written by sync-to-neon.sh after each successful staging run (Beijing wall time).
  "site-sync": "site-sync.json",
} as const;

export type SiteSyncStamp = { syncedAt: string; syncedAtIso?: string };

export function loadSiteSync(): SiteSyncStamp | null {
  const file = path.join(config.dataDir, SITE_BLOB_FILES["site-sync"]);
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as SiteSyncStamp;
    const syncedAt = typeof raw?.syncedAt === "string" ? raw.syncedAt.trim() : "";
    if (!syncedAt) return null;
    return { syncedAt, ...(typeof raw.syncedAtIso === "string" ? { syncedAtIso: raw.syncedAtIso } : {}) };
  } catch {
    return null;
  }
}

/** 「11 月 10 日 19:23 北京时间」from a Beijing stamp such as "2026-11-10 19:23". */
export function formatDataAsOf(syncedAt: string): string {
  const m = syncedAt.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return syncedAt ? `${syncedAt} 北京时间` : "";
  return `${Number(m[2])} 月 ${Number(m[3])} 日 ${m[4]}:${m[5]} 北京时间`;
}

export type SiteBlobKey = keyof typeof SITE_BLOB_FILES;

const onVercel = !!process.env.VERCEL;
let lastHydrateAt = 0;

function stampOf(value: Date | string): string {
  return typeof value === "string" ? value : value.toISOString();
}

export async function writeSiteBlob(key: SiteBlobKey, payload: unknown): Promise<void> {
  const [row] = await sql<{ updated_at: Date | string }[]>`
    INSERT INTO site_blobs (key, payload, updated_at)
    VALUES (${key}, ${sql.json(payload as never)}, now())
    ON CONFLICT (key) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()
    RETURNING updated_at`;
  const file = path.join(config.dataDir, SITE_BLOB_FILES[key]);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(payload), "utf8");
  if (row) await writeFile(`${file}.updated_at`, stampOf(row.updated_at), "utf8");
  lastHydrateAt = 0;
}

export async function readSiteBlob<T = unknown>(key: SiteBlobKey): Promise<T | null> {
  try {
    const [row] = await sql<{ payload: T }[]>`SELECT payload FROM site_blobs WHERE key = ${key}`;
    return row?.payload ?? null;
  } catch {
    return null;
  }
}

/**
 * On a filesystem without the catalogs (Vercel /tmp), copy them out of Postgres so the existing
 * synchronous file readers keep working. A missing table is ignored so Docker can boot before the
 * migration is applied.
 *
 * Docker keeps the on-disk catalogs as the source of truth and is not overwritten.
 * On Vercel, a sidecar records site_blobs.updated_at so a later sync is visible on warm instances.
 */
export async function hydrateSiteBlobsFromDb(opts?: { force?: boolean; maxAgeMs?: number }): Promise<void> {
  const force = opts?.force ?? false;
  const maxAgeMs = opts?.maxAgeMs ?? 15_000;
  const now = Date.now();
  if (!force && lastHydrateAt > 0 && now - lastHydrateAt < maxAgeMs) return;

  await mkdir(config.dataDir, { recursive: true });
  for (const [key, name] of Object.entries(SITE_BLOB_FILES) as [SiteBlobKey, string][]) {
    const dest = path.join(config.dataDir, name);
    // Local Docker catalogs live on disk; never replace them with a possibly empty cloud table.
    if (!onVercel && existsSync(dest) && !force) continue;
    try {
      const [row] = await sql<{ payload: unknown; updated_at: Date | string }[]>`
        SELECT payload, updated_at FROM site_blobs WHERE key = ${key}`;
      if (row?.payload == null) continue;
      const stamp = stampOf(row.updated_at);
      const meta = `${dest}.updated_at`;
      if (!force && existsSync(dest) && existsSync(meta) && readFileSync(meta, "utf8") === stamp) continue;
      await writeFile(dest, JSON.stringify(row.payload), "utf8");
      await writeFile(meta, stamp, "utf8");
    } catch {
      // Table missing, or the database is not reachable yet.
    }
  }
  lastHydrateAt = Date.now();
}
