/**
 * The /voices loader sends only a 12-item preview. Filters run on the client against the full
 * catalog (fetched after paint). A later loader payload can come from a cold API instance with
 * an empty catalog (generatedAt ""). These helpers keep a good catalog from being replaced by a
 * shorter one, and stop the page from treating "no matches in a preview slice" as a real empty result.
 */

export function mergeVoiceItems<T>(prev: T[], incoming: T[]): T[] {
  return incoming.length >= prev.length ? incoming : prev;
}

export function knownCatalogTotal(...candidates: Array<number | undefined | null>): number {
  let n = 0;
  for (const c of candidates) {
    if (typeof c === "number" && Number.isFinite(c) && c > n) n = c;
  }
  return n;
}

export function voicesCatalogReady(itemCount: number, total: number): boolean {
  return total > 0 && itemCount >= total;
}

/** Same-path search changes are client-side filters; refetching the loader can hit a cold empty catalog. */
export function voicesSearchOnlyRevalidate(
  currentPathname: string,
  nextPathname: string,
  currentSearch: string,
  nextSearch: string,
  defaultShouldRevalidate: boolean,
): boolean {
  if (currentPathname === nextPathname && currentSearch !== nextSearch) return false;
  return defaultShouldRevalidate;
}

export function voicesMatchCount(opts: {
  ready: boolean;
  filteredLength: number;
  scoped: boolean;
  platform: string;
  railPlatformCounts: Record<string, number>;
  railTotal: number;
}): number {
  if (opts.ready) return opts.filteredLength;
  if (!opts.scoped) return opts.railTotal || opts.filteredLength;
  if (opts.platform !== "all") {
    const n = opts.railPlatformCounts[opts.platform];
    if (typeof n === "number") return n;
  }
  return opts.filteredLength;
}
