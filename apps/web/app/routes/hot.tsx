import { useLoaderData } from "react-router";
import { WordTitle } from "../components/ui/WordTitle";
import { Link } from "react-router";
import type { Route } from "./+types/hot";
import { IntentLink } from "../components/ui/IntentLink";
import type { FeedItemSummary, HotEntryView, HotResponse, PoolResponse, TimelineResponse } from "@aihot/contracts/site";
import { beijingDate } from "@aihot/contracts/time";
import { shortAddresses } from "@aihot/contracts/addresses";
import { SEO_TITLES, subjectAfter, withSubject } from "@aihot/site";
import { apiGet, cachedPage, loadOr404, previewApiBase } from "../lib/api.server";
import { pageReuse } from "../lib/page-reuse";
import { archiveLd, listPath, pageMeta, timelineApiParams } from "../lib/seo";
import { monthDay, relativeTime } from "../lib/format";
import { Badge } from "../components/ui/Badge";
import { EmptyState, MoreLink } from "../components/ui/Page";
import { IconChevronDown, IconChevronRight, IconInfo } from "../components/icons";
import { Sparkline } from "../features/hot/Sparkline";
import { Delta } from "../features/hot/Delta";
import { PhoneBar } from "../components/shell/PhoneBar";
import { Picture } from "../components/ui/Picture";
import { navUp } from "../components/shell/nav";
import { scrollBehavior } from "../lib/motion";
import type { Screen } from "../components/shell/screens";
import { computedAtBeijing, emptyKind, formatHeat, isStale, sourceLineParts, updatedAtLabel, type Fallback, type FallbackItem } from "../features/hot/presentation";
import { applyDemoState, demoState, previewEnabled } from "../features/hot/preview";

export const handle: Screen = { tab: navUp("/hot").tab, name: "热点" };
export { pageHeaders as headers } from "../lib/api.server";
// Two expressions, not one shared binding, so the router can ship the client loader as its own tiny chunk.
export const clientLoader = pageReuse<typeof loader>().clientLoader;
export const shouldRevalidate = pageReuse<typeof loader>().shouldRevalidate;

function asFallbackItem(item: Pick<FeedItemSummary, "id" | "title" | "source" | "timelineAt" | "publishedAt" | "selected">): FallbackItem {
  return {
    id: item.id,
    title: item.title,
    sourceName: item.source.name,
    at: item.timelineAt ?? item.publishedAt,
    selected: item.selected,
  };
}

async function tryGet<T>(path: string, signal?: AbortSignal): Promise<T | null> {
  try {
    return await apiGet<T>(path, { signal, base: previewApiBase() });
  } catch {
    return null;
  }
}
async function loadFallback(signal?: AbortSignal): Promise<Fallback> {
  const featured = await tryGet<TimelineResponse>(
    listPath("/api/site/timeline", timelineApiParams({ channel: "all", category: null, tag: null, slot: "featured" })),
    signal,
  );
  const featuredItems = (featured?.cards ?? []).slice(0, 8).map((c) => asFallbackItem(c.item));
  if (featuredItems.length) return { kind: "featured", items: featuredItems };
  const pool = await tryGet<PoolResponse>(listPath("/api/site/pool", { page: 1 }), signal);
  const latest = (pool?.items ?? []).slice(0, 8).map(asFallbackItem);
  if (latest.length) return { kind: "latest", items: latest };
  return null;
}

export async function loader({ request }: { request: Request }) {
  // Always the real api (a preview reads its own); ?state= only switches a preview to a demo state.
  const state = previewEnabled() ? demoState(new URL(request.url).searchParams.get("state")) : null;
  const upstream = new Headers();
  const remote = await loadOr404<HotResponse>("/api/site/hot", { signal: request.signal, responseHeaders: upstream, base: previewApiBase() });
  const hot = applyDemoState(remote, state);
  const fallback: Fallback = hot.entries.length === 0 ? await loadFallback(request.signal) : null;
  return cachedPage(120, { hot, fallback, demo: state }, state ? undefined : upstream);
}

export function meta({ loaderData }: Route.MetaArgs) {
  const hot = loaderData?.hot;
  const entries = hot?.entries ?? [];
  // A search result answers "what is hot today" with the three events the page leads with, dated by the ranking.
  const lead = hot?.computedAt && entries.length
    ? `${subjectAfter(monthDay(beijingDate(hot.computedAt)), "热点")}：${entries.slice(0, 3).map((e) => e.story.title).join("；")}。`
    : "";
  return pageMeta({
    title: SEO_TITLES.hot,
    description: `${lead}${subjectAfter("过去 48 小时", "圈")}讨论最多的 10 个事件：热度、走势，以及都有谁在报道。`,
    path: "/hot",
    image: "/og/pages/hot.png",
    jsonLd: entries.length ? archiveLd("/hot", SEO_TITLES.hot, entries.map((e) => ({ path: `/story/${e.story.publicId}`, name: e.story.title }))) : undefined,
  });
}

const BADGES: Record<HotEntryView["badges"][number], { label: string; tone: "hot" | "accent" | "amber"; hint: string }> = {
  surge: { label: "爆", tone: "hot", hint: "讨论快速增加" },
  new: { label: "新", tone: "accent", hint: "首报 6 小时内" },
  rising: { label: "发酵中", tone: "amber", hint: "讨论仍在增加" },
};

const RANK_COLOR = ["text-rank-1", "text-rank-2", "text-rank-3"];
const rankColor = (rank: number) => RANK_COLOR[rank - 1] ?? "text-rank-rest";
const pad = (rank: number) => String(rank).padStart(2, "0");

/** Names may wrap; the count never splits (「1 个来源」 stays on one line). */
function SourceLine({ e }: { e: HotEntryView }) {
  const [names, count] = sourceLineParts(e.sourceCount, e.sourceNames);
  return (
    <>
      {names}
      <span data-src-count="" className="whitespace-nowrap">{count}</span>
    </>
  );
}

function Voices({ e }: { e: HotEntryView }) {
  return (
    <span className="min-w-0 text-[0.875rem] leading-snug text-ink-4">
      <span className="text-ink-3"><SourceLine e={e} /></span>
      {e.latestAt && (
        <>
          <span aria-hidden="true" className="mx-2 text-line-strong">·</span>
          <time className="whitespace-nowrap num" dateTime={e.latestAt} suppressHydrationWarning>
            {relativeTime(e.latestAt)}
          </time>
        </>
      )}
    </span>
  );
}

function Badges({ e }: { e: HotEntryView }) {
  return e.badges.map((b) => (
    <Badge key={b} tone={BADGES[b].tone} title={BADGES[b].hint}>
      {BADGES[b].label}
    </Badge>
  ));
}

/** The whole card opens the event; the title carries the link and stretches over the card. */
function StoryLink({ e, className }: { e: HotEntryView; className: string }) {
  return (
    <IntentLink viewTransition to={`/story/${e.story.publicId}`} className={`transition-colors after:absolute after:inset-0 after:content-[''] ${className}`}>
      <WordTitle>{e.story.title}</WordTitle>
    </IntentLink>
  );
}

/**
 * The lead card's picture slot when the story has no picture of its own: its day of heat, drawn large
 * on a faint wash, with where it peaked. Without enough comparable hours the text takes the width.
 */
function HeatPanel({ e }: { e: HotEntryView }) {
  const seen = e.spark.filter((v): v is number => v !== null);
  const peak = Math.max(...seen);
  const peakAt = e.spark.findIndex((v) => v === peak);
  return (
    <div className="order-first flex aspect-[2/1] flex-col rounded-panel bg-accent-softer p-4 ring-1 ring-inset ring-line-soft xl:order-none xl:aspect-[16/10] dark:bg-accent-soft">
      <div className="flex items-baseline justify-between text-[0.75rem] text-ink-4">
        <span className="font-semibold text-ink-3">24 小时热度</span>
        <span>
          峰值 <span className="mono text-ink-2">{formatHeat(peak)}</span>
          {peakAt >= 0 && <span> · {peakAt === e.spark.length - 1 ? "当前" : `${e.spark.length - 1 - peakAt} 小时前`}</span>}
        </span>
      </div>
      <Sparkline values={e.spark} className="mt-3 min-h-0 w-full flex-1" />
      <div className="mt-2 flex justify-between text-[0.75rem] text-ink-4">
        <span>24 小时前</span>
        <span>现在</span>
      </div>
    </div>
  );
}

function FullListLink() {
  return (
    <a
      href="#full-list"
      className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[0.875rem] font-semibold text-accent hover:text-accent-ink lg:hidden"
    >
      完整榜单
      <IconChevronRight size={14} />
    </a>
  );
}

/** No. 1: the event people are talking about most, with its picture, digest, latest turn and day of heat. */
function Lead({ e, hasMore }: { e: HotEntryView; hasMore: boolean }) {
  const panel = !e.cover && e.spark.filter((v) => v !== null).length >= 3;
  return (
    <article className="card card-hover card-press group relative flex flex-col overflow-hidden p-5 sm:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <span className={`mono text-[0.75rem] font-bold tracking-[0.16em] ${rankColor(e.rank)}`}>NO.{pad(e.rank)}</span>
        <Badges e={e} />
        <Delta trend={e.trend} pct={e.trendPct} className="ml-auto" />
      </div>
      <div className={`mt-4 grid gap-5 ${e.cover || panel ? "xl:grid-cols-[minmax(0,1fr)_minmax(0,0.72fr)] xl:gap-7" : ""}`}>
        <div className="min-w-0">
          <h2 className="text-[1.25rem] font-semibold leading-[1.45] text-ink lg:text-[1.75rem] lg:leading-[1.3]">
            <StoryLink e={e} className="group-hover:text-accent" />
          </h2>
          {e.summary && <p className="mt-3 line-clamp-3 text-[0.875rem] leading-[1.75] text-ink-3">{shortAddresses(e.summary)}</p>}
        </div>
        {e.cover ? (
          <div className="order-first overflow-hidden well rounded-panel xl:order-none">
            <Picture src={e.cover.url} srcSet={e.cover.srcSet} sizes="(min-width: 1280px) calc(28vw - 96px), (min-width: 1024px) calc(58vw - 180px), (min-width: 640px) 568px, calc(100vw - 74px)" width={e.cover.width ?? undefined} height={e.cover.height ?? undefined} alt="" loading="eager" fetchPriority="high" decoding="async" className="aspect-[16/9] size-full object-cover xl:aspect-[16/10]" />
          </div>
        ) : (
          panel && <HeatPanel e={e} />
        )}
      </div>
      {/* Side by side while the card is wide enough; on a narrow card the day of heat and the index
          move under the voices, to the right, instead of squeezing them into a column. */}
      <div className="mt-auto flex flex-wrap items-end gap-x-6 gap-y-4 pt-5">
        <div className="min-w-0 flex-[1_1_18rem] space-y-3">
          {e.latest && (
            <p className="line-clamp-2 text-[0.875rem] leading-[1.7] text-ink-2">
              <span className="mr-2 text-[0.75rem] font-semibold text-accent">最新进展</span>
              {e.latest}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Voices e={e} />
          </div>
        </div>
        <div className="flex w-full shrink-0 items-end justify-between gap-5 sm:ml-auto sm:w-auto sm:justify-end">
          {!panel && <Sparkline values={e.spark} className="h-10 w-[140px]" />}
          <div className="text-right">
            <div className="mono text-[1.75rem] font-semibold leading-none tracking-[-0.03em] text-ink">{formatHeat(e.heat)}</div>
            <div className="mt-1 text-[0.75rem] text-ink-4">热度指数</div>
          </div>
        </div>
      </div>
      {hasMore && (
        <div className="mt-4 flex lg:hidden">
          <FullListLink />
        </div>
      )}
    </article>
  );
}

/** No. 2 and 3 (desktop): the same card, smaller, without the picture. */
function Runner({ e }: { e: HotEntryView }) {
  return (
    <article className="card card-hover card-press group relative flex flex-col px-5 py-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className={`mono text-[0.75rem] font-bold tracking-[0.16em] ${rankColor(e.rank)}`}>NO.{pad(e.rank)}</span>
        <Badges e={e} />
        <Delta trend={e.trend} pct={e.trendPct} className="ml-auto" />
      </div>
      <h2 className="mt-3 line-clamp-2 text-[1rem] font-semibold leading-[1.5] text-ink">
        <StoryLink e={e} className="group-hover:text-accent" />
      </h2>
      {e.summary && <p className="mt-2 line-clamp-2 text-[0.875rem] leading-[1.7] text-ink-3 lg:line-clamp-1">{shortAddresses(e.summary)}</p>}
      <div className="mt-auto flex flex-wrap items-end justify-between gap-x-4 gap-y-2 pt-3">
        <div className="flex min-w-0 flex-col gap-2">
          <span className="text-[0.75rem] leading-snug text-ink-4">
            <span className="text-ink-3"><SourceLine e={e} /></span>
            {e.latestAt && (
              <>
                <span className="mx-1">·</span>
                <time className="whitespace-nowrap num" dateTime={e.latestAt} suppressHydrationWarning>
                  {relativeTime(e.latestAt)}
                </time>
              </>
            )}
          </span>
        </div>
        <div className="ml-auto flex items-end gap-3">
          <Sparkline values={e.spark} className="h-7 w-[92px]" />
          <span className="mono text-[1.75rem] font-semibold leading-none tracking-[-0.02em] text-ink">{formatHeat(e.heat)}</span>
        </div>
      </div>
    </article>
  );
}

/** Compact ranked row: name, source line, heat and movement sit in fixed columns. */
function Row({ e }: { e: HotEntryView }) {
  return (
    <li className="group relative grid grid-cols-[2.5rem_minmax(0,1fr)] items-start gap-x-3 px-4 py-3 transition-colors hover:bg-bg-sunk/70 sm:px-5 wide:grid-cols-[2.75rem_minmax(0,1fr)_minmax(8rem,14rem)_104px_76px] wide:items-center wide:gap-x-6 wide:px-6 wide:py-4 dark:hover:bg-bg-muted/40">
      <span className={`mono w-full text-right text-[1rem] font-semibold leading-[24px] tabular-nums ${rankColor(e.rank)}`} aria-label={`热度排名第 ${e.rank} 位`}>
        {pad(e.rank)}
      </span>
      <div className="min-w-0">
        <h3 className="text-[0.875rem] font-semibold leading-[1.55] text-ink">
          <StoryLink e={e} className="group-hover:text-accent" />
          {e.badges.length > 0 && (
            <span className="ml-2 inline-flex translate-y-[-2px] flex-wrap gap-1 align-middle">
              <Badges e={e} />
            </span>
          )}
        </h3>
        {e.summary && <p className="mt-1 line-clamp-2 text-[0.875rem] leading-[1.65] text-ink-4 wide:line-clamp-1">{shortAddresses(e.summary)}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 wide:hidden">
          <span className="min-w-0 text-[0.75rem] text-ink-4"><SourceLine e={e} /></span>
          {e.latestAt && (
            <time className="whitespace-nowrap text-[0.75rem] text-ink-4 num" dateTime={e.latestAt} suppressHydrationWarning>
              {relativeTime(e.latestAt)}
            </time>
          )}
          <span className="ml-auto flex items-center gap-2">
            <span className="mono text-[1rem] font-semibold leading-none text-ink">{formatHeat(e.heat)}</span>
            <Delta trend={e.trend} pct={e.trendPct} />
          </span>
        </div>
      </div>
      <div className="hidden min-w-0 flex-col items-start gap-0.5 text-[0.75rem] text-ink-4 wide:flex">
        <span><SourceLine e={e} /></span>
        {e.latestAt && (
          <time className="whitespace-nowrap num" dateTime={e.latestAt} suppressHydrationWarning>
            {relativeTime(e.latestAt)}
          </time>
        )}
      </div>
      <Sparkline values={e.spark} className="hidden h-7 w-[104px] wide:block" />
      <div className="hidden flex-col items-end gap-1 wide:flex">
        <span className="mono text-[1.25rem] font-semibold leading-none tracking-[-0.02em] text-ink">{formatHeat(e.heat)}</span>
        <Delta trend={e.trend} pct={e.trendPct} />
      </div>
    </li>
  );
}

/** Opens "热度是怎么算的" at the foot of the page and brings it into view. */
function showMethod() {
  const method = document.getElementById("hot-method") as HTMLDetailsElement | null;
  if (!method) return;
  method.open = true;
  method.scrollIntoView({ behavior: scrollBehavior(), block: "center" });
}

function FeedActions() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
      <Link viewTransition to="/" className="inline-flex items-center gap-1 whitespace-nowrap text-[0.875rem] font-semibold text-accent hover:text-accent-ink">
        去看精选
        <IconChevronRight size={14} />
      </Link>
      <Link viewTransition to="/all" className="inline-flex items-center gap-1 whitespace-nowrap text-[0.875rem] font-semibold text-accent hover:text-accent-ink">
        去看全部动态
        <IconChevronRight size={14} />
      </Link>
    </div>
  );
}

function FallbackList({ fallback }: { fallback: NonNullable<Fallback> }) {
  const to = fallback.kind === "featured" ? "/" : "/all";
  const title = fallback.kind === "featured" ? "先看精选" : "先看最新动态";
  const more = fallback.kind === "featured" ? "更多精选" : "全部动态";
  return (
    <section aria-label={title} className="mt-6">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 px-1">
        <h2 className="text-[0.875rem] font-semibold text-ink">{title}</h2>
        <MoreLink to={to}>{more}</MoreLink>
      </div>
      <ol className="card divide-y divide-line-soft overflow-hidden">
        {fallback.items.map((item) => (
          <li key={item.id}>
            <Link viewTransition to={`/items/${item.id}`} className="flex flex-col gap-1 px-4 py-3 transition-colors hover:bg-bg-sunk/70 sm:px-5 dark:hover:bg-bg-muted/40">
              <span className="text-[0.875rem] font-semibold leading-[1.55] text-ink">{item.title}</span>
              <span className="flex flex-wrap items-center gap-x-2 text-[0.75rem] text-ink-4">
                <span>{item.sourceName}</span>
                {item.selected && <span>精选</span>}
                <time className="num" dateTime={item.at} suppressHydrationWarning>
                  {relativeTime(item.at)}
                </time>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

export default function HotPage() {
  const { hot, fallback, demo } = useLoaderData<typeof loader>();
  const stale = isStale(hot.computedAt);
  const [lead, ...rest] = hot.entries;
  const runners = rest.slice(0, 2);
  const phoneRows = hot.entries.slice(1);
  const desktopRows = hot.entries.slice(3);
  const kind = !lead ? emptyKind(hot.computedAt) : null;

  const freshSub = (
    <>
      过去 {hot.windowHours}{`${subjectAfter(" 小时", "圈")}讨论最多的 `}{hot.entries.length || 10} 件事
      {hot.computedAt && (
        <>
          {" · "}
          <span className="num">{updatedAtLabel(hot.computedAt)}</span>
        </>
      )}
    </>
  );
  const staleSub = (
    <>
      榜单已过期
      {hot.computedAt && (
        <>
          {" · "}
          上次更新于 <span className="num">{computedAtBeijing(hot.computedAt)}</span>
        </>
      )}
    </>
  );

  const allSingle = hot.entries.length > 0 && hot.entries.every((e) => Math.max(e.sourceCount, e.sourceNames.filter(Boolean).length) <= 1);
  return (
    <div className="pb-10" data-hot-page="" data-all-single={allSingle ? "" : undefined}>
      <PhoneBar
        title="热点"
        large
        sub={stale ? staleSub : freshSub}
        actions={
          <button type="button" onClick={showMethod} className="flex h-11 items-center gap-1 px-3 text-[0.875rem] text-accent active:opacity-50">
            <IconInfo size={17} /> 怎么算
          </button>
        }
      />
      <header className="hidden flex-wrap items-end justify-between gap-x-6 gap-y-2 pb-5 pt-1 lg:flex">
        <div>
          {stale ? (
            <div className="text-[0.75rem] font-semibold tracking-[0.08em] text-ink-3">榜单已过期</div>
          ) : (
            <div className="flex items-center gap-2 text-[0.75rem] font-semibold tracking-[0.08em] text-hot">
              <span className="relative flex size-2" aria-hidden="true">
                <span className="relative inline-flex size-2 rounded-full bg-hot" />
              </span>
              实时热度
            </div>
          )}
          <h1 className="mt-2 text-[1.75rem] font-semibold leading-[1.3] text-ink">{withSubject("热点榜")}</h1>
          {stale ? (
            <p className="mt-2 text-[0.875rem] text-ink-2">
              {hot.computedAt
                ? lead
                  ? `上次更新于 ${computedAtBeijing(hot.computedAt)}，已超过一轮。下面仍是当时的榜单，仅供参考。`
                  : `上次更新于 ${computedAtBeijing(hot.computedAt)}，已超过一轮，正在重算。`
                : "榜单尚未算出，正在重算。"}
            </p>
          ) : (
            <p className="mt-2 text-[0.875rem] text-ink-3">过去 {hot.windowHours}{` 小时，${withSubject("圈")}讨论最多的 `}{hot.entries.length || 10} 件事</p>
          )}
        </div>
        {hot.computedAt && !stale && (
          <p className="text-[0.75rem] text-ink-4">
            <span className="num">{updatedAtLabel(hot.computedAt)}</span>
            {" · 按讨论热度排序"}
          </p>
        )}
      </header>

      {demo && (
        <p className="mb-4 text-[0.75rem] leading-relaxed text-ink-4">预览演示状态（?state={demo}）：{demo === "stale" ? "榜单内容取自接口，只把更新时间往前推了 14 小时" : "榜单按空榜演示"}，不是接口原样。去掉参数即为接口当前结果。</p>
      )}

      {allSingle && (
        <p data-single-note="" className="mb-4 hidden text-[0.875rem] leading-[1.7] text-ink-3">本期 {hot.entries.length} 条都只有一个来源报道，出现交叉报道后会标出来源数。</p>
      )}
      {lead && (
        // The chosen looks' one-row ranking (编辑部: serif numerals); the classic design keeps the cards below.
        <ol data-hot-rows="" aria-label="热点榜" className="hidden">
          {hot.entries.map((e) => (
            <li key={e.story.publicId} data-hot-row="">
              <span data-hot-rank="" aria-label={`热度排名第 ${e.rank} 位`}>{e.rank}</span>
              <span data-hot-main="">
                <span data-hot-title=""><StoryLink e={e} className="hover:text-accent" /></span>
                <span data-hot-meta=""><SourceLine e={e} />{e.latestAt && <> · <time dateTime={e.latestAt} suppressHydrationWarning>{relativeTime(e.latestAt)}</time></>}</span>
              </span>
              <span data-hot-heat="" title="热度指数">{formatHeat(e.heat)}</span>
            </li>
          ))}
        </ol>
      )}

      {!lead ? (
        <div className="card rounded-sheet">
          {kind === "stale" ? (
            <EmptyState
              title="榜单已过期，正在重算"
              action={<FeedActions />}
            >
              {hot.computedAt
                ? `上次更新于 ${computedAtBeijing(hot.computedAt)}，已超过一轮（13 小时）。先看精选或全部动态。`
                : "榜单还没有算出来。先看精选或全部动态。"}
            </EmptyState>
          ) : (
            <EmptyState title="本轮没有多源事件" action={<FeedActions />}>
              过去 {hot.windowHours} 小时，还没有足够多来源共同讨论的事件。先看精选或全部动态。
            </EmptyState>
          )}
        </div>
      ) : (
        <>
          <section data-hot-cards="" aria-label="热度榜首" className="grid grid-cols-1 gap-3 lg:grid-cols-12 lg:gap-4">
            <div className="grid grid-cols-1 lg:col-span-7 lg:row-span-2 xl:col-span-8">
              <Lead e={lead} hasMore={hot.entries.length > 1} />
            </div>
            {runners.map((e) => (
              <div key={e.story.publicId} className="hidden grid-cols-1 lg:grid lg:col-span-5 xl:col-span-4">
                <Runner e={e} />
              </div>
            ))}
          </section>

          {(phoneRows.length > 0 || desktopRows.length > 0) && (
            <section data-hot-cards="" id="full-list" aria-label="完整榜单" className="mt-6 scroll-mt-[calc(var(--bar-h)+16px)] lg:mt-7">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-1">
                <h2 className="text-[0.875rem] font-semibold text-ink">
                  完整榜单{" "}
                  <span className="num font-normal text-ink-4 lg:hidden">No.{pad(phoneRows[0]?.rank ?? 2)}–{pad(hot.entries[hot.entries.length - 1]!.rank)}</span>
                  <span className="num hidden font-normal text-ink-4 lg:inline">
                    {desktopRows.length > 0 ? `No.${pad(desktopRows[0]!.rank)}–${pad(desktopRows[desktopRows.length - 1]!.rank)}` : ""}
                  </span>
                </h2>
                <span className="hidden text-[0.75rem] text-ink-4 wide:block">来源 · 更新时间 · 24 小时走势 · 热度指数</span>
              </div>
              <ol className="card divide-y divide-line-soft overflow-hidden lg:hidden">
                {phoneRows.map((e) => (
                  <Row key={e.story.publicId} e={e} />
                ))}
              </ol>
              {desktopRows.length > 0 && (
                <ol className="card hidden divide-y divide-line-soft overflow-hidden lg:block">
                  {desktopRows.map((e) => (
                    <Row key={e.story.publicId} e={e} />
                  ))}
                </ol>
              )}
            </section>
          )}
        </>
      )}

      {fallback && <FallbackList fallback={fallback} />}

      <details id="hot-method" className="disclosure group/method mt-8 scroll-mt-[calc(var(--bar-h)+16px)] text-[0.75rem] text-ink-4">
        <summary className="flex items-center gap-2 py-1 transition-colors hover:text-ink-2">
          <IconInfo size={15} />
          热度是怎么算的？
          <span className="ml-auto inline-flex items-center gap-1">
            <span className="group-open/method:hidden">了解榜单</span>
            <span className="hidden group-open/method:inline">收起</span>
            <IconChevronDown size={13} className="transition-transform duration-200 group-open/method:rotate-180" />
          </span>
        </summary>
        <div className="max-w-[760px] space-y-2 pb-2 pl-[20px] pt-2 leading-[1.75] text-ink-3">
          <p>热度先看有多少家独立报道在讨论同一件事，再计入公开互动的对数，越近的讨论分量越重，每过 24 小时减半（Hacker News 式衰减）。它反映讨论有多热闹，不代表报道质量。只有一家来源时也会上榜，并标明「1 个来源」。</p>
          <p>榜单只看过去 48 小时。走势只拿同一批一直在看的来源比较，反映的是我们看得到的范围，不代表全网人数；没有可比的历史时，不画走势线。</p>
          <p>
            来源名单只列能公开阅读的报道；参与讨论的还有一些不在名单里展示的账号和机构。同一家机构在不同平台发帖合并算一家，所以参与者可能比来源还少。点进事件，可以看各方的报道和观点。
          </p>
          <dl className="flex flex-wrap gap-x-5 gap-y-2 pt-1">
            {Object.values(BADGES).map((b) => (
              <div key={b.label} className="flex items-center gap-2">
                <dt>
                  <Badge tone={b.tone}>{b.label}</Badge>
                </dt>
                <dd>{b.hint}</dd>
              </div>
            ))}
          </dl>
        </div>
      </details>
    </div>
  );
}
