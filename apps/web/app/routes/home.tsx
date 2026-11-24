import { useEffect, useState } from "react";
import { Link, redirect, useLoaderData } from "react-router";
import { SITE } from "@aihot/site";
import type { Route } from "./+types/home";
import type { HotResponse, ReportIndexResponse, TimelineResponse } from "@aihot/contracts/site";
import { beijingDate } from "@aihot/contracts/time";
import { apiGet, cachedPage, loadOr404, previewApiBase } from "../lib/api.server";
import { WordTitle } from "../components/ui/WordTitle";
import { useSiteStyle } from "../lib/site-styles";
import { markRead, useReadSet, useUnreadOnly } from "../lib/local-state";
import { formatWhen } from "../lib/voice-time";
import { pageReuse } from "../lib/page-reuse";
import { filterParams, hasFeedFilters, itemListLd, listPath, pageMeta, readFilters, siteLd, timelineApiParams } from "../lib/seo";
import { inNav } from "../components/shell/nav";
import type { Screen } from "../components/shell/screens";
import type { FacetsMeta } from "../components/facets/FacetChips";
import { IconBuilding, IconLandmark, IconLayers, IconMessage } from "../components/icons";
import { Timeline } from "../features/feed/Timeline";
import { HotTopics } from "../features/feed/HotTopics";
import { JournalHero } from "../features/feed/JournalHero";
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
interface RailVoice { id: string; title: string; author: string; platform: string; url: string; day?: string | null; published_at?: string | null }

const JOURNAL_RADAR = [
  { to: "/voices", label: "社区热帖", hint: "一线口碑实测", icon: IconMessage },
  { to: "/companies", label: "公司动态", hint: "厂商产品进展", icon: IconBuilding },
  { to: "/policies", label: "国内政策", hint: "部委省市发文", icon: IconLandmark },
  { to: "/all", label: "全部动态", hint: "实时信源全库", icon: IconLayers },
] as const;

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
  const unreadOnly = useUnreadOnly();
  const readSet = useReadSet();
  const title = filters.tag ? `#${filters.tag}` : "精选";
  const front = !hasFeedFilters(filters);
  const firstCard = front && data.cards.length > 0 ? data.cards[0]! : null;
  const leadCard =
    firstCard && (!unreadOnly || !readSet.has(firstCard.item.id) || (firstCard.group?.memberIds?.some((id) => !readSet.has(id)) ?? false))
      ? firstCard
      : null;
  return (
    <div className="pb-6">
      <FeedBar base="/" category={filters.category} channel={filters.channel} meta={facets} />
      <ActiveFilters base="/" category={filters.category} channel={filters.channel} tag={filters.tag} />
      {front && <Masthead today={today} issue={issue} todayCount={data.dayCounts[today] ?? 0} />}
      {leadCard && (
        <JournalHero
          lead={leadCard}
          issue={issue}
          today={today}
          todayCount={data.dayCounts[today] ?? 0}
          hot={railHot}
          onOpenLead={markRead}
        />
      )}
      <DesktopFacetBlock
        base="/"
        title={title}
        titleHidden={front}
        meta={facets}
        search={
          <div data-home-inline-search="" className="shrink-0">
            <SearchField keep={{ category: filters.category }} />
          </div>
        }
      />

      {data.hot && inNav("/hot") && <HotTopics entries={data.hot} />}

      <div data-home-grid="">
        <div data-home-main="">
          <Timeline initial={data} filters={filters} leadKey={leadCard?.key ?? null} />
        </div>
        {front && <HomeRail hot={railHot} issue={issue} today={today} todayCount={data.dayCounts[today] ?? 0} />}
      </div>
    </div>
  );
}

/** The chosen looks' right rail at 1176px and up. Hidden in the classic design (styles/looks/layout.css). */
function HomeRail({ hot, issue, today, todayCount }: { hot: RailHot[]; issue: MastheadIssue | null; today: string; todayCount: number }) {
  const style = useSiteStyle();
  if (hot.length === 0 && !issue && style !== "journal" && style !== "clean") return null;
  return (
    <aside data-home-rail="" aria-label="情报侧栏" className="space-y-4">
      {issue && (
        <section data-rail-card="" data-rail-daily="" aria-label="每日日报">
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
        <section data-rail-card="" data-rail-hot="" aria-label="热点榜前 5">
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
      <section data-rail-card="" data-journal-radar="" aria-label="情报雷达" className="hidden">
        <div className="flex items-baseline justify-between border-b border-line pb-2">
          <h2 className="text-[1rem] font-bold text-ink">情报雷达</h2>
          <span className="text-[0.75rem] text-ink-4">专题入口</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2.5">
          {JOURNAL_RADAR.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="group flex flex-col gap-1 rounded-tile border border-line-soft bg-bg/65 p-2.5 transition-all duration-200 hover:-translate-y-px hover:border-line-strong hover:bg-bg-muted"
            >
              <span className="flex items-center gap-1.5 text-[0.8125rem] font-semibold text-ink transition-colors group-hover:text-accent">
                <item.icon size={15} className="shrink-0 text-accent" />
                <span className="truncate">{item.label}</span>
              </span>
              <span className="truncate text-[0.75rem] text-ink-4">{item.hint}</span>
            </Link>
          ))}
        </div>
      </section>
      <CommunityRail today={today} />
    </aside>
  );
}

/**
 * 社区在聊 under the hot list, for 刊物 and 明净／夜读. Load it once the desktop rail can be shown.
 */
function CommunityRail({ today }: { today: string }) {
  const style = useSiteStyle();
  const [voices, setVoices] = useState<RailVoice[]>([]);
  useEffect(() => {
    if (style !== "clean" && style !== "journal") return;
    const ctl = new AbortController();
    const desktop = window.matchMedia("(min-width: 1176px)");
    function loadWhenVisible() {
      if (!desktop.matches) return;
      desktop.removeEventListener("change", loadWhenVisible);
      fetch("/api/site/voices", { headers: { accept: "application/json" }, signal: ctl.signal })
        .then((res) => (res.ok ? res.json() : null))
        .then((body: unknown) => setVoices(railVoices(body, 6)))
        .catch(() => { /* the rail just stays without it */ });
    }
    desktop.addEventListener("change", loadWhenVisible);
    loadWhenVisible();
    return () => {
      desktop.removeEventListener("change", loadWhenVisible);
      ctl.abort();
    };
  }, [style]);
  const shown = voices.slice(0, style === "journal" ? 6 : 4);
  return (
    <>
      {shown.length > 0 && (
        <section data-rail-card="" data-community-rail="" aria-label="社区在聊">
          <div className="flex items-baseline justify-between border-b border-line pb-2">
            <h2 className="text-[1rem] font-bold text-ink">社区在聊</h2>
            <span className="text-[0.75rem] text-ink-4">一线实测</span>
          </div>
          <ul>
            {shown.map((v) => {
              const title = splitVoiceProvenance(v.title).summary || v.title;
              const when = formatWhen(
                { day: typeof v.day === "string" ? v.day : null, published_at: typeof v.published_at === "string" ? v.published_at : null },
                today,
              );
              return (
                <li key={v.id} className="border-b border-line-soft py-2.5 last:border-b-0">
                  <a href={v.url} target="_blank" rel="noopener noreferrer" className="line-clamp-2 block text-[0.9375rem] leading-[1.55] text-ink transition-colors hover:text-accent"><WordTitle>{title}</WordTitle></a>
                  <div className="mt-1.5 flex items-center gap-1.5 text-[0.75rem] text-ink-4">
                    <span className="inline-flex shrink-0 items-center rounded-mark border border-line-soft bg-bg-sunk px-1.5 py-0.5 text-[0.6875rem] font-medium leading-none text-ink-3">{v.platform}</span>
                    <span className="min-w-0 truncate">{v.author}</span>
                    {when && (
                      <>
                        <span aria-hidden="true" className="shrink-0">·</span>
                        <span className="mono shrink-0">{when}</span>
                      </>
                    )}
                  </div>
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

/** The leading posts of a /api/site/voices answer; anything else reads as none. */
function railVoices(body: unknown, limit: number): RailVoice[] {
  const items = typeof body === "object" && body !== null && "items" in body && Array.isArray(body.items) ? body.items : [];
  return items.filter(isRailVoice).slice(0, limit);
}
