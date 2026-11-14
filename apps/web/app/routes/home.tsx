import { redirect, useLoaderData } from "react-router";
import { SITE } from "@aihot/site";
import type { Route } from "./+types/home";
import type { TimelineResponse } from "@aihot/contracts/site";
import { apiGet, cachedPage, loadOr404 } from "../lib/api.server";
import { pageReuse } from "../lib/page-reuse";
import { filterParams, hasFeedFilters, itemListLd, listPath, pageMeta, readFilters, siteLd, timelineApiParams } from "../lib/seo";
import { inNav } from "../components/shell/nav";
import type { Screen } from "../components/shell/screens";
import type { FacetsMeta } from "../components/facets/FacetChips";
import { Timeline } from "../features/feed/Timeline";
import { HotTopics } from "../features/feed/HotTopics";
import { ActiveFilters, DesktopFacetBlock, FeedBar, SearchField } from "../features/feed/Filters";

export const handle: Screen = { tab: "featured", name: "精选" };
export { pageHeaders as headers } from "../lib/api.server";
export const { clientLoader, shouldRevalidate } = pageReuse<typeof loader>();

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q");
  // Search lives on /all; keep the parameters so old links still land on results.
  if (q && q.trim()) throw redirect(`/all${url.search}`);
  const filters = { ...readFilters(url.searchParams), slot: "featured" as const };
  const upstream = new Headers();
  const [data, facets] = await Promise.all([
    loadOr404<TimelineResponse>(listPath("/api/site/timeline", timelineApiParams(filters)), { responseHeaders: upstream, signal: request.signal }),
    apiGet<FacetsMeta>("/api/site/facets", { responseHeaders: upstream, signal: request.signal }),
  ]);
  // A minute at most, here and on /all: new selections must not wait longer at the edge or in a browser.
  return cachedPage(60, { data, filters, facets }, upstream);
}

export function meta({ loaderData }: Route.MetaArgs) {
  const path = listPath("/", loaderData ? filterParams(loaderData.filters) : {});
  const titles = loaderData?.data.cards.map((c) => c.item.title) ?? [];
  const tags = pageMeta({ path, noindex: hasFeedFilters(loaderData?.filters), jsonLd: path === "/" ? [...siteLd(), itemListLd("/", "精选", titles)] : undefined });
  // Webmaster platforms look for their verification tag on the home page only.
  if (path !== "/") return tags;
  return [...tags, ...Object.entries(SITE.siteVerification).map(([name, content]) => ({ name, content }))];
}

export default function Home() {
  const { data, filters, facets } = useLoaderData<typeof loader>();
  const title = filters.tag ? `#${filters.tag}` : "精选";
  return (
    <div className="pb-6">
      <FeedBar base="/" category={filters.category} channel={filters.channel} meta={facets} />
      <ActiveFilters base="/" category={filters.category} channel={filters.channel} tag={filters.tag} />
      <DesktopFacetBlock base="/" title={title} meta={facets} search={<SearchField keep={{ category: filters.category }} />} />

      {data.hot && inNav("/hot") && <HotTopics entries={data.hot} />}

      <Timeline initial={data} filters={filters} />
    </div>
  );
}
