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

/** 近 7 天最热 includes a post only when its age is within 7 days. A missing age stays outside. */
export function inVoicesHotWindow(ageDays: number | null | undefined): boolean {
  return (ageDays ?? 99) <= 7;
}

/**
 * The hot list is empty because nothing in the current filters falls inside 7 days, while older
 * posts with those same filters still exist. The action drops only the window.
 */
export function voicesHotWindowEmpty(input: {
  sort: "latest" | "hot";
  platform: string;
  narrowed: boolean;
  windowCount: number;
  allTimeCount: number;
}): { title: string; count: number; action: string } | null {
  if (input.sort !== "hot" || input.windowCount > 0 || input.allTimeCount <= 0) return null;
  const platform = input.platform !== "all" ? input.platform : "";
  const title = platform
    ? (input.narrowed ? `近7天无符合筛选的${platform}帖子` : `近7天无${platform}帖子`)
    : (input.narrowed ? "近7天无符合筛选的帖子" : "近7天无帖子");
  return { title, count: input.allTimeCount, action: `查看全部时间${input.allTimeCount}条` };
}

/**
 * 清空 drops platform, source, verify and facet chips. It does not leave 近 7 天最热, so that
 * label says the window stays.
 */
export function voicesClearFiltersLabel(sort: "latest" | "hot"): string {
  return sort === "hot" ? "清空筛选，仍看近 7 天" : "清空筛选";
}
