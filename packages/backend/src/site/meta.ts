// Small site-wide facts for the web shell (e.g. the changelog red-dot anchor).
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ChangelogResponse, SiteMeta } from "@aihot/contracts/site";
import { publicCopy } from "@aihot/site/public-copy";
import { REPO_ROOT } from "../config.ts";

let changelogCache: ChangelogResponse | null = null;

/** Changelog is published as a data file of the site (site/changelog.json), newest first. */
export function loadChangelog(): ChangelogResponse {
  if (!changelogCache) {
    const raw = JSON.parse(readFileSync(path.join(REPO_ROOT, "site/changelog.json"), "utf8")) as ChangelogResponse;
    changelogCache = {
      ...raw,
      releases: (raw.releases ?? []).map((r) => ({
        ...r,
        title: publicCopy(r.title) || r.title,
        body: (r.body ?? []).map((line) => publicCopy(line) || line),
      })),
    };
  }
  return changelogCache;
}

export function siteMeta(): SiteMeta {
  return { changelogVersion: loadChangelog().latestVersion };
}
