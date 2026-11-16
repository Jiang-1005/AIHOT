/**
 * The /voices loader sends only a 12-item preview. Filters run on the client against the full
 * catalog (fetched after paint). These helpers keep a full catalog from being replaced by a later
 * preview slice, and stop the page from treating "no matches in a preview slice" as a real empty result.
 * An unreadable catalog is a 503 from the API, not a 200 empty list.
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

/** Same-path search changes are client-side filters; they must not revalidate the loader. */
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
