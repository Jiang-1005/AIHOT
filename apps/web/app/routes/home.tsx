import { useEffect, useState } from "react";
import { Link, redirect, useLoaderData } from "react-router";
import { SITE } from "@aihot/site";
import type { Route } from "./+types/home";
import type { HotResponse, ReportIndexResponse, TimelineResponse } from "@aihot/contracts/site";
import { beijingDate } from "@aihot/contracts/time";
import { apiGet, cachedPage, loadOr404, previewApiBase } from "../lib/api.server";
import { WordTitle } from "../components/ui/WordTitle";
import { useSiteStyle } from "../lib/site-styles";
import { pageReuse } from "../lib/page-reuse";
import { filterParams, hasFeedFilters, itemListLd, listPath, pageMeta, readFilters, siteLd, timelineApiParams } from "../lib/seo";
import { inNav } from "../components/shell/nav";
import type { Screen } from "../components/shell/screens";
import type { FacetsMeta } from "../components/facets/FacetChips";
import { Timeline } from "../features/feed/Timeline";
import { HotTopics } from "../features/feed/HotTopics";
import { Masthead, type MastheadIssue } from "../features/feed/Masthead";
import { ActiveFilters, DesktopFacetBlock, FeedBar, SearchField } from "../features/feed/Filters";
import { splitVoiceProvenance } from "../features/voices/clean-summary";

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
  const [data, facets, dailies, hotBoard] = await Promise.all([
    loadOr404<TimelineResponse>(listPath("/api/site/timeline", timelineApiParams(filters)), { responseHeaders: upstream, signal: request.signal }),
    apiGet<FacetsMeta>("/api/site/facets", { responseHeaders: upstream, signal: request.signal }),
    // The masthead's issue number; without it the masthead leaves the number out rather than fail the page.
    apiGet<ReportIndexResponse>("/api/site/reports/daily", { signal: request.signal }).catch(() => null),
    // The chosen looks' right rail (热点榜 top five); the classic design does not show it.
    apiGet<HotResponse>("/api/site/hot", { signal: request.signal, base: previewApiBase() }).catch(() => null),
  ]);
  const railHot: RailHot[] = (hotBoard?.entries ?? []).slice(0, 5).map((e) => ({ rank: e.rank, title: e.story.title, to: `/story/${e.story.publicId}`, sources: e.sourceNames.filter(Boolean).slice(0, 2).join("、") }));
  const latest = dailies?.items[0];
  const issue: MastheadIssue | null = latest ? { key: latest.key, issueNumber: latest.issueNumber } : null;
  // The day is the server's, so the page hydrates with the date it was rendered with.
  const today = beijingDate(Date.now());
  // A minute at most, here and on /all: new selections must not wait longer at the edge or in a browser.
  return cachedPage(60, { data, filters, facets, issue, today, railHot }, upstream);
}

interface RailHot { rank: number; title: string; to: string; sources: string }
interface RailVoice { id: string; title: string; author: string; platform: string; url: string }

export function meta({ loaderData }: Route.MetaArgs) {
  const path = listPath("/", loaderData ? filterParams(loaderData.filters) : {});
  const titles = loaderData?.data.cards.map((c) => c.item.title) ?? [];
  const tags = pageMeta({ path, noindex: hasFeedFilters(loaderData?.filters), jsonLd: path === "/" ? [...siteLd(), itemListLd("/", "精选", titles)] : undefined });
  // Webmaster platforms look for their verification tag on the home page only.
  if (path !== "/") return tags;
  return [...tags, ...Object.entries(SITE.siteVerification).map(([name, content]) => ({ name, content }))];
}

export default function Home() {
  const { data, filters, facets, issue, today, railHot } = useLoaderData<typeof loader>();
  const title = filters.tag ? `#${filters.tag}` : "精选";
  const front = !hasFeedFilters(filters);
  return (
    <div className="pb-6">
      <FeedBar base="/" category={filters.category} channel={filters.channel} meta={facets} />
      <ActiveFilters base="/" category={filters.category} channel={filters.channel} tag={filters.tag} />
      {front && <Masthead today={today} issue={issue} todayCount={data.dayCounts[today] ?? 0} />}
      <DesktopFacetBlock base="/" title={title} titleHidden={front} meta={facets} search={<SearchField keep={{ category: filters.category }} />} />

      {data.hot && inNav("/hot") && <HotTopics entries={data.hot} />}

      <div data-home-grid="">
        <div data-home-main="">
          <Timeline initial={data} filters={filters} />
        </div>
        {front && <HomeRail hot={railHot} issue={issue} today={today} todayCount={data.dayCounts[today] ?? 0} />}
      </div>
    </div>
  );
}

/** The chosen looks' right rail at 1176px and up. Hidden in the classic design (styles/looks/layout.css). */
function HomeRail({ hot, issue, today, todayCount }: { hot: RailHot[]; issue: MastheadIssue | null; today: string; todayCount: number }) {
  if (hot.length === 0 && !issue) return null;
  return (
    <aside data-home-rail="" aria-label="情报侧栏" className="space-y-4">
      {issue && (
        <section data-rail-card="" aria-label="每日日报">
          <div className="flex items-center justify-between text-[0.75rem] text-ink-4">
            <span className="font-medium tracking-[0.06em] text-accent">每日日报</span>
            <span className="num">第 {issue.issueNumber} 期</span>
          </div>
          <h2 className="mt-1.5 text-[1rem] font-bold leading-[1.45] text-ink">
            {issue.key === today ? "今日精选速览" : `${issue.key} 刊期归档`}
          </h2>
          <p className="mt-1 text-[0.875rem] leading-[1.6] text-ink-3">
            {todayCount > 0 ? `今日收录精选 ${todayCount} 条，汇总核心动向与一手解读。` : "汇聚近期教育 AI 重要进展与政策产业脉络。"}
          </p>
          <Link to={`/daily/${issue.key}`} className="mt-3 inline-flex items-center gap-1 text-[0.875rem] font-semibold text-accent hover:text-accent-ink">
            阅读本期日报 →
          </Link>
        </section>
      )}
      {hot.length > 0 && (
        <section data-rail-card="" aria-label="热点榜前 5">
          <div className="flex items-baseline justify-between border-b border-line pb-2">
            <h2 className="text-[1rem] font-bold text-ink">热点榜</h2>
            <span className="text-[0.75rem] text-ink-4">近 48 小时</span>
          </div>
          <ol>
            {hot.map((e) => (
              <li key={e.rank} className="border-b border-line-soft last:border-b-0">
                <Link viewTransition to={e.to} className="block py-2.5 text-[0.9375rem] leading-[1.55] text-ink transition-colors hover:text-accent">
                  <span className="flex gap-2"><span className="num shrink-0 font-semibold text-accent">{e.rank}.</span><span className="min-w-0"><WordTitle>{e.title}</WordTitle></span></span>
                  {e.sources && <span className="mt-0.5 block pl-5 text-[0.8125rem] text-ink-3">{e.sources}</span>}
                </Link>
              </li>
            ))}
          </ol>
          <Link to="/hot" className="mt-2 inline-block text-[0.875rem] font-semibold text-accent hover:text-accent-ink">查看完整热点榜 →</Link>
        </section>
      )}
      <CommunityRail />
    </aside>
  );
}

/**
 * 社区在聊 under the hot list, for 刊物 and 明净／夜读. Fetched once that look is on, from this deployment's
 * own API, so the classic page never pays for the voices catalogue.
 */
function CommunityRail() {
  const style = useSiteStyle();
  const [voices, setVoices] = useState<RailVoice[]>([]);
  useEffect(() => {
    if (style !== "clean" && style !== "journal") return;
    const ctl = new AbortController();
    fetch("/api/site/voices", { headers: { accept: "application/json" }, signal: ctl.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: unknown) => setVoices(railVoices(body)))
      .catch(() => { /* the rail just stays without it */ });
    return () => ctl.abort();
  }, [style]);
  return (
    <>
      {voices.length > 0 && (
        <section data-rail-card="" data-community-rail="" aria-label="社区在聊">
          <div className="flex items-baseline justify-between border-b border-line pb-2">
            <h2 className="text-[1rem] font-bold text-ink">社区在聊</h2>
            <span className="text-[0.75rem] text-ink-4">一线实测</span>
          </div>
          <ul>
            {voices.map((v) => {
              const title = splitVoiceProvenance(v.title).summary;
              return (
                <li key={v.id} className="border-b border-line-soft py-2.5 last:border-b-0">
                  <a href={v.url} target="_blank" rel="noopener noreferrer" className="line-clamp-2 text-[0.9375rem] leading-[1.55] text-ink hover:text-accent"><WordTitle>{title}</WordTitle></a>
                  <span className="mt-1 block text-[0.8125rem] text-ink-3">{v.platform} · {v.author}</span>
                </li>
              );
            })}
          </ul>
          <Link to="/voices" className="mt-2 inline-block text-[0.875rem] font-semibold text-accent hover:text-accent-ink">更多社区热帖 →</Link>
        </section>
      )}
    </>
  );
}

const isRailVoice = (v: unknown): v is RailVoice =>
  typeof v === "object" && v !== null &&
  "id" in v && typeof v.id === "string" && "title" in v && typeof v.title === "string" &&
  "author" in v && typeof v.author === "string" && "platform" in v && typeof v.platform === "string" &&
  "url" in v && typeof v.url === "string" && /^https?:\/\//.test(v.url);

/** The first four posts of a /api/site/voices answer; anything else reads as none. */
function railVoices(body: unknown): RailVoice[] {
  const items = typeof body === "object" && body !== null && "items" in body && Array.isArray(body.items) ? body.items : [];
  return items.filter(isRailVoice).slice(0, 4);
}
