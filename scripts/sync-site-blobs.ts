// Upsert voices.json and content-tags.json from AIHOT_DATA_DIR (or --dir) into site_blobs.
// Intended for the box: after a daily import, write the catalogs to Neon so Vercel can read them.
// Usage: node --env-file-if-exists=.env scripts/sync-site-blobs.ts
// Never prints secrets or file contents.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { config, REPO_ROOT } from "@aihot/backend/config";
import { closeDb } from "@aihot/backend/db";
import { writeSiteBlob, SITE_BLOB_FILES, type SiteBlobKey } from "@aihot/backend/publication/site-blobs";

const dirFlag = process.argv.indexOf("--dir");
const dir = dirFlag >= 0 && process.argv[dirFlag + 1] ? path.resolve(process.argv[dirFlag + 1]!) : config.dataDir;

let failed = 0;
for (const [key, name] of Object.entries(SITE_BLOB_FILES) as [SiteBlobKey, string][]) {
  const file = path.join(dir, name);
  const fallback = path.join(REPO_ROOT, ".data", name);
  const src = existsSync(file) ? file : existsSync(fallback) ? fallback : null;
  if (!src) {
    console.log(`skip ${key}: ${name} not found`);
    continue;
  }
  try {
    const payload = JSON.parse(readFileSync(src, "utf8"));
    await writeSiteBlob(key, payload);
    console.log(`upserted ${key} from ${path.relative(REPO_ROOT, src) || src}`);
  } catch (error) {
    failed += 1;
    console.error(`failed ${key}: ${error instanceof Error ? error.message : "error"}`);
  }
}
await closeDb();
if (failed) process.exit(1);
