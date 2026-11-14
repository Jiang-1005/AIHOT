import { redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/archive";
import type { TimelineResponse } from "@aihot/contracts/site";
import { apiGet, cachedPage, loadOr404 } from "../lib/api.server";
import { pageReuse } from "../lib/page-reuse";
import { filterParams, hasFeedFilters, itemListLd, listPath, pageMeta, readFilters, timelineApiParams } from "../lib/seo";
import type { Screen } from "../components/shell/screens";
import type { FacetsMeta } from "../components/facets/FacetChips";
import { Timeline } from "../features/feed/Timeline";
import { ActiveFilters, DesktopFacetBlock, FeedBar, SearchField } from "../features/feed/Filters";

export const handle: Screen = { tab: "featured", name: "往期" };
export { pageHeaders as headers } from "../lib/api.server";
export const { clientLoader, shouldRevalidate } = pageReuse<typeof loader>();

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q");
  if (q && q.trim()) throw redirect(`/all${url.search}`);
  const filters = { ...readFilters(url.searchParams), slot: "archive" as const };
  const upstream = new Headers();
  const [data, facets] = await Promise.all([
    loadOr404<TimelineResponse>(listPath("/api/site/timeline", timelineApiParams(filters)), { responseHeaders: upstream, signal: request.signal }),
    apiGet<FacetsMeta>("/api/site/facets", { responseHeaders: upstream, signal: request.signal }),
  ]);
  return cachedPage(60, { data, filters, facets }, upstream);
}

export function meta({ loaderData }: Route.MetaArgs) {
  const path = listPath("/archive", loaderData ? filterParams(loaderData.filters) : {});
  const titles = loaderData?.data.cards.map((c) => c.item.title) ?? [];
  return pageMeta({
    title: "往期",
    description: "通过统一门槛与核验、稿件日期在 8 到 30 天内的报道，不出现在首页精选。",
    path,
    noindex: hasFeedFilters(loaderData?.filters),
    jsonLd: path === "/archive" ? itemListLd("/archive", "往期", titles) : undefined,
  });
}

export default function Archive() {
  const { data, filters, facets } = useLoaderData<typeof loader>();
  const title = filters.tag ? `#${filters.tag}` : "往期";
  return (
    <div className="pb-6">
      <FeedBar base="/archive" category={filters.category} channel={filters.channel} meta={facets} />
      <ActiveFilters base="/archive" category={filters.category} channel={filters.channel} tag={filters.tag} />
      <DesktopFacetBlock
        base="/archive"
        title={title}
        blurb={<p className="mt-2 text-[14px] leading-6 text-ink-3">通过统一门槛（60）与核验、稿件日期在 8 到 30 天内的报道。首页精选只保留 7 天内的稿件。</p>}
        meta={facets}
        search={<SearchField keep={{ category: filters.category }} />}
      />

      <Timeline
        initial={data}
        filters={filters}
        emptyTitle="现在还没有往期内容"
        emptyHint="通过门槛与核验、稿件日期在 8 到 30 天内的报道会出现在这里。"
      />
    </div>
  );
}
