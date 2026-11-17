// 精选's five-dimension filters show only once the api can answer them: /api/site/facets carries
// featuredCounts (精选's own counts) and the timeline's cards carry their `facets`. Before that the chips
// would count every report yet list no 精选 at all, so the page leaves them out.
import type { FacetsMeta } from "../components/facets/FacetChips";

function anyCount(counts: FacetsMeta["featuredCounts"]): boolean {
  return !!counts && Object.values(counts).some((byValue) => Object.values(byValue ?? {}).some((n) => n > 0));
}

/** The chips' data for 精选 (its own counts), or null while the api has no 精选 dimensions. */
export function featuredFacetMeta(meta: FacetsMeta, cards: ReadonlyArray<{ item: object }>, filtering: boolean): FacetsMeta | null {
  if (!anyCount(meta.featuredCounts)) return null;
  // A choice that lists nothing still keeps the chips, so it can be undone.
  const tagged = filtering || cards.some((c) => (c.item as { facets?: unknown }).facets != null);
  return tagged ? { ...meta, counts: meta.featuredCounts! } : null;
}
