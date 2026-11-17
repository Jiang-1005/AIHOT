import { Link, redirect, useLoaderData } from "react-router";
import { SITE } from "@aihot/site";
import type { Route } from "./+types/home";
import type { HotStripEntry, ReportIndexResponse, TimelineResponse } from "@aihot/contracts/site";
import { WordTitle } from "../components/ui/WordTitle";
import { beijingDate } from "@aihot/contracts/time";
import { apiGet, cachedPage, loadOr404 } from "../lib/api.server";
import { pageReuse } from "../lib/page-reuse";
import { filterParams, hasFeedFilters, itemListLd, listPath, pageMeta, readFilters, siteLd, timelineApiParams } from "../lib/seo";
import { inNav } from "../components/shell/nav";
import type { Screen } from "../components/shell/screens";
import type { FacetsMeta } from "../components/facets/FacetChips";
import { Timeline } from "../features/feed/Timeline";
import { HotTopics } from "../features/feed/HotTopics";
import { Masthead, type MastheadIssue } from "../features/feed/Masthead";
import { ActiveFilters, DesktopFacetBlock, FeedBar, SearchField } from "../features/feed/Filters";

export const handle: Screen = { tab: "featured", name: "精选" };
export { pageHeaders as headers } from "../lib/api.server";
// Two expressions, not one shared binding, so the router can ship the client loader as its own tiny chunk.
export const clientLoader = pageReuse<typeof loader>().clientLoader;
export const shouldRevalidate = pageReuse<typeof loader>().shouldRevalidate;

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q");
  // Search lives on /all; keep the parameters so old links still land on results.
  if (q && q.trim()) throw redirect(`/all${url.search}`);
  const filters = { ...readFilters(url.searchParams), slot: "featured" as const };
  const upstream = new Headers();
  const [data, facets, dailies] = await Promise.all([
    loadOr404<TimelineResponse>(listPath("/api/site/timeline", timelineApiParams(filters)), { responseHeaders: upstream, signal: request.signal }),
    apiGet<FacetsMeta>("/api/site/facets", { responseHeaders: upstream, signal: request.signal }),
    // The masthead's issue number; without it the masthead leaves the number out rather than fail the page.
    apiGet<ReportIndexResponse>("/api/site/reports/daily", { signal: request.signal }).catch(() => null),
  ]);
  const latest = dailies?.items[0];
  const issue: MastheadIssue | null = latest ? { key: latest.key, issueNumber: latest.issueNumber } : null;
  const latestDaily = latest ? { key: latest.key, issueNumber: latest.issueNumber, title: latest.title, count: latest.count } : null;
  // The day is the server's, so the page hydrates with the date it was rendered with.
  const today = beijingDate(Date.now());
  // A minute at most, here and on /all: new selections must not wait longer at the edge or in a browser.
  return cachedPage(60, { data, filters, facets, issue, latestDaily, today }, upstream);
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
  const { data, filters, facets, issue, latestDaily, today } = useLoaderData<typeof loader>();
  const title = filters.tag ? `#${filters.tag}` : "精选";
  const front = !hasFeedFilters(filters);
  const hot = data.hot && inNav("/hot") ? data.hot : null;
  return (
    <div className="pb-6">
      <FeedBar base="/" category={filters.category} channel={filters.channel} meta={facets} />
      <ActiveFilters base="/" category={filters.category} channel={filters.channel} tag={filters.tag} />
      {front && <Masthead today={today} issue={issue} todayCount={data.dayCounts[today] ?? 0} />}
      <DesktopFacetBlock base="/" title={title} titleHidden={front} meta={facets} search={<SearchField keep={{ category: filters.category }} />} />

      {/* Wide desktops: the feed beside a rail (热点榜 top five, the latest daily), as in the 11-17 prototypes.
          Narrower screens keep the hot strip above the feed. */}
      <div className="side:grid side:grid-cols-[minmax(0,1fr)_300px] side:items-start side:gap-10">
        <div className="min-w-0">
          {hot && <div className="side:hidden"><HotTopics entries={hot} /></div>}
          <Timeline initial={data} filters={filters} />
        </div>
        <HomeRail hot={hot} daily={latestDaily} />
      </div>
    </div>
  );
}

function HomeRail({ hot, daily }: { hot: HotStripEntry[] | null; daily: { key: string; issueNumber: number; title: string | null; count: number } | null }) {
  if (!hot?.length && !daily) return null;
  return (
    <aside data-home-rail="" aria-label="侧栏" className="hidden space-y-8 side:sticky side:top-[calc(var(--bar-h)+1.5rem)] side:block">
      {hot && hot.length > 0 && (
        <section aria-labelledby="rail-hot">
          <h2 id="rail-hot" className="border-b border-line pb-2 text-[1rem] font-bold text-ink">热点榜</h2>
          <ol>
            {hot.slice(0, 5).map((e) => (
              <li key={e.rank} className="border-b border-line-soft">
                <Link viewTransition to={e.storyPublicId ? `/story/${e.storyPublicId}` : e.itemId ? `/items/${e.itemId}` : "/hot"} className="flex gap-2 py-3 text-[0.9375rem] leading-[1.6] text-ink transition-colors hover:text-accent">
                  <span className="num shrink-0 font-semibold text-accent">{e.rank}.</span>
                  <span className="min-w-0"><WordTitle>{e.title}</WordTitle></span>
                </Link>
              </li>
            ))}
          </ol>
          <Link to="/hot" className="mt-3 inline-block text-[0.875rem] font-semibold text-accent hover:text-accent-ink">完整热点榜</Link>
        </section>
      )}
      {daily && (
        <section aria-labelledby="rail-daily">
          <h2 id="rail-daily" className="border-b border-line pb-2 text-[1rem] font-bold text-ink">最新日报</h2>
          <Link to={`/daily/${daily.key}`} className="block py-3 text-[0.9375rem] leading-[1.6] text-ink transition-colors hover:text-accent">
            <span className="num text-[0.8125rem] text-ink-3">第 {daily.issueNumber} 期 · {daily.count} 条</span>
            {daily.title && <span className="mt-1 block font-semibold"><WordTitle>{daily.title}</WordTitle></span>}
          </Link>
          <Link to="/archive" className="inline-block text-[0.875rem] font-semibold text-accent hover:text-accent-ink">全部往期</Link>
        </section>
      )}
    </aside>
  );
}
