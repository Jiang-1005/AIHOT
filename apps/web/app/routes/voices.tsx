import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useLoaderData, useSearchParams } from "react-router";
import { SITE } from "@aihot/site";
import { Wordmark } from "@aihot/site/brand/Logo.tsx";
import type { Route } from "./+types/voices";
import { cachedPage, loadOr404 } from "../lib/api.server";
import { pageReuse } from "../lib/page-reuse";
import { pageMeta } from "../lib/seo";
import { publicCopy } from "../lib/public-copy";
import type { Screen } from "../components/shell/screens";
import { PhoneBar } from "../components/shell/PhoneBar";
import { EmptyState } from "../components/ui/Page";
import {
  EMPTY_FACETS,
  FacetChipRows,
  LogoMark,
  SelectedFacetBars,
  companyChipName,
  facetsEqualEmpty,
  logoFor,
  type FacetState,
  type FacetVocab,
} from "../components/facets/FacetChips";

export const handle: Screen = { tab: "featured", name: "社区热帖" };
export { pageHeaders as headers } from "../lib/api.server";
export const { clientLoader, shouldRevalidate } = pageReuse<typeof loader>();

interface VoiceTags {
  topic: string;
  subject: string;
  subject_raw?: string;
  companies: string[];
  form: string;
  content_type: string;
}

const CN_PLATFORMS = new Set(["知乎", "微博", "即刻", "豆瓣", "B站", "微信"]);

interface VoiceCard {
  id: string;
  platform: string;
  url: string;
  author: string;
  poster: string;
  source?: string;
  unverified_label?: string | null;
  identity_unconfirmed?: boolean;
  verified?: boolean;
  published_at: string | null;
  day: string | null;
  slot: "featured" | "archive";
  age_days?: number | null;
  metrics: Record<string, number | string | null | undefined>;
  title: string;
  brief?: string | null;
  quote: string;
  summary?: string | null;
  why: string;
  tags?: VoiceTags;
}

interface VoicesResponse {
  catalog: { generatedAt: string; asOf: string; section: string; counts: { featured: number; archive: number; total?: number } };
  items: VoiceCard[];
  vocab: FacetVocab;
  headCompanies: string[];
  logos: { index: Record<string, string>; missing: string[] };
  dataAsOf?: string;
  filteredCount?: number;
}

const SOURCE_ORDER = ["家长自述", "教师自述", "学生自述", "KOL 测评", "官方或品牌号", "媒体", "研究或论文", "成人学习者", "教育从业者", "通用", "身份未确认"];
const INITIAL_VISIBLE = 12;
const LOAD_MORE = 24;
const LOAD_AHEAD_PX = 1200;

function isCnCommunity(platform: string): boolean {
  return CN_PLATFORMS.has(platform);
}

function platformFromParams(params: URLSearchParams): PlatformKey {
  const raw = params.get("platform");
  if (raw === "X" || raw === "小红书" || raw === "中文社区") return raw;
  if (raw && CN_PLATFORMS.has(raw)) return raw;
  return "all";
}

function matchesPlatform(item: VoiceCard, platform: PlatformKey): boolean {
  if (platform === "all") return true;
  if (platform === "中文社区") return isCnCommunity(item.platform);
  return item.platform === platform;
}

function facetsFromParams(params: URLSearchParams): FacetState {
  return {
    topic: (params.get("topic") || "").split(",").filter(Boolean),
    subject: (params.get("subject") || "").split(",").filter(Boolean),
    form: (params.get("form") || "").split(",").filter(Boolean),
    content_type: (params.get("content_type") || "").split(",").filter(Boolean),
    company: (params.get("company") || "").split(",").filter(Boolean),
  };
}

function sortVoices(rows: VoiceCard[], sort: SortKey): VoiceCard[] {
  if (sort === "hot") {
    return [...rows].sort((a, b) => likesOf(b) - likesOf(a) || (b.published_at || "").localeCompare(a.published_at || ""));
  }
  return [...rows].sort((a, b) => {
    const day = (b.day || "").localeCompare(a.day || "");
    if (day) return day;
    const likes = likesOf(b) - likesOf(a);
    if (likes) return likes;
    return (b.published_at || "").localeCompare(a.published_at || "");
  });
}

function filterVoices(items: VoiceCard[], sort: SortKey, platform: PlatformKey, source: string, facets: FacetState): VoiceCard[] {
  const rows = items.filter((item) => {
    if (!matchesPlatform(item, platform)) return false;
    if (source !== "all" && (item.source || item.poster) !== source) return false;
    if (sort === "hot" && (item.age_days ?? 99) > 7) return false;
    return itemMatches(item, facets);
  });
  return sortVoices(rows, sort);
}

function voiceSourceOptions(items: VoiceCard[]): { name: string; count: number }[] {
  const bag = new Map<string, number>();
  for (const item of items) {
    const name = item.source || item.poster;
    if (!name) continue;
    bag.set(name, (bag.get(name) ?? 0) + 1);
  }
  return [...bag.keys()].sort((a, b) => {
    const ia = SOURCE_ORDER.indexOf(a);
    const ib = SOURCE_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b, "zh");
  }).map((name) => ({ name, count: bag.get(name) ?? 0 }));
}

function voiceCompanyCounts(items: VoiceCard[]): Record<string, number> {
  const bag: Record<string, number> = {};
  for (const item of items) {
    const names = new Set((item.tags?.companies ?? []).map(companyChipName).filter((n): n is string => !!n));
    for (const name of names) bag[name] = (bag[name] ?? 0) + 1;
  }
  return bag;
}

export async function loader({ request }: Route.LoaderArgs) {
  const upstream = new Headers();
  const data = await loadOr404<VoicesResponse>("/api/site/voices", { responseHeaders: upstream, signal: request.signal });
  const params = new URL(request.url).searchParams;
  const sort: SortKey = params.get("sort") === "hot" ? "hot" : "latest";
  const platform = platformFromParams(params);
  const source = sourceFromParams(params);
  const facets = facetsFromParams(params);
  const filtered = filterVoices(data.items, sort, platform, source, facets);
  const preview = filtered.slice(0, INITIAL_VISIBLE);
  return cachedPage(60, {
    ...data,
    items: preview,
    itemsPartial: preview.length < filtered.length,
    sourceOptions: voiceSourceOptions(data.items),
    companyCounts: voiceCompanyCounts(data.items),
    catalogTotal: data.catalog.counts.total ?? data.items.length,
    filteredCount: filtered.length,
  }, upstream);
}

export function meta() {
  return pageMeta({
    title: "社区热帖",
    path: "/voices",
    description: "收录 X、小红书和中文社区里的教育相关讨论，和媒体精选分开，也不走 60 分门槛。",
  });
}

type SortKey = "latest" | "hot";
type PlatformKey = "all" | "X" | "小红书" | "中文社区" | string;

function baseLabel(value: string | null | undefined): string {
  if (!value) return "";
  return String(value).split("｜")[0].trim();
}

function likesOf(item: VoiceCard): number {
  const n = item.metrics?.likes;
  const v = typeof n === "string" ? Number(String(n).replace(/,/g, "")) : Number(n ?? 0);
  return Number.isFinite(v) ? v : 0;
}

function formatCount(n: number): string {
  if (n >= 10_000) return `${(n / 10_000).toFixed(n >= 100_000 ? 0 : 1).replace(/\.0$/, "")} 万`;
  return String(Math.round(n));
}

function formatDay(day: string | null, published: string | null): string {
  const raw = day || (published || "").slice(0, 10);
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return raw || "";
  return `${Number(m[2])}/${Number(m[3])}`;
}

function metricOf(item: VoiceCard, key: string): number {
  const n = item.metrics?.[key];
  const v = typeof n === "string" ? Number(String(n).replace(/,/g, "")) : Number(n ?? 0);
  return Number.isFinite(v) ? v : 0;
}

function formatFetchedAt(raw: unknown): string {
  if (!raw) return "";
  const m = String(raw).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return "";
  return `${Number(m[2])} 月 ${Number(m[3])} 日 ${m[4]}:${m[5]} 北京时间`;
}

const ENGAGEMENT_PARTS: { key: string; label: string }[] = [
  { key: "likes", label: "赞" },
  { key: "reposts", label: "转发" },
  { key: "replies", label: "回复" },
  { key: "quotes", label: "引用" },
  { key: "bookmarks", label: "收藏" },
  { key: "views", label: "浏览" },
];

function engagementParts(item: VoiceCard): string[] {
  return ENGAGEMENT_PARTS.flatMap(({ key, label }) => {
    const n = metricOf(item, key);
    return n > 0 ? [`${formatCount(n)} ${label}`] : [];
  });
}


function sourceFromParams(params: URLSearchParams): string {
  const direct = params.get("source");
  if (direct) return direct;
  const id = params.get("identity");
  if (id === "家长") return "家长自述";
  if (id === "老师" || id === "教师") return "教师自述";
  if (id === "学生") return "学生自述";
  return "all";
}

function countLabel(n: number, platform: PlatformKey, scoped: boolean): string {
  if (platform === "小红书") return `小红书 ${n} 条`;
  if (platform === "X") return `X ${n} 条`;
  if (platform === "中文社区") return `中文社区 ${n} 条`;
  if (CN_PLATFORMS.has(platform)) return `${platform} ${n} 条`;
  if (!scoped) return `共 ${n} 条，来自 X、小红书和中文社区`;
  return `共 ${n} 条`;
}


function splitQuote(text: string | undefined): { claim: boolean; body: string } {
  const raw = (text || "").trim();
  if (raw.startsWith("【用户自述】")) return { claim: true, body: raw.slice("【用户自述】".length) };
  return { claim: raw.includes("用户自述"), body: raw.replace(/【用户自述】/g, "") };
}

function chipClass(on: boolean): string {
  return on ? "voice-chip is-on" : "voice-chip";
}

function itemMatches(item: VoiceCard, facets: FacetState): boolean {
  const tags = item.tags;
  const hit = (sel: string[], value: string | undefined) => !sel.length || (value != null && sel.includes(baseLabel(value)));
  if (!hit(facets.topic, tags?.topic)) return false;
  if (!hit(facets.subject, tags?.subject)) return false;
  if (!hit(facets.form, tags?.form)) return false;
  if (!hit(facets.content_type, tags?.content_type)) return false;
  if (facets.company.length) {
    const names = (tags?.companies ?? []).map(companyChipName).filter((n): n is string => !!n);
    if (!facets.company.some((c) => names.includes(c))) return false;
  }
  return true;
}

function FilterRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-2">
      <div className="w-16 shrink-0 pt-1 text-[12px] font-medium text-ink-4">{label}</div>
      <div className="flex min-w-0 flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

const PLATFORM_MARK: Record<string, { label: string; aria: string }> = {
  小红书: { label: "书", aria: "小红书" },
  知乎: { label: "知", aria: "知乎" },
  微博: { label: "博", aria: "微博" },
  即刻: { label: "即", aria: "即刻" },
  豆瓣: { label: "豆", aria: "豆瓣" },
  B站: { label: "B", aria: "B站" },
  微信: { label: "信", aria: "微信" },
};

function PlatformMark({ platform }: { platform: string }) {
  if (platform === "X") {
    return (
      <span className="voice-platform-mark" aria-label="X">
        <svg viewBox="0 0 16 16" width="9" height="9" aria-hidden="true"><path fill="currentColor" d="M12.6 1.5h2.2L9.7 7.1 16 14.5h-4.9L7.6 9.8 3.3 14.5H1.1l5.5-6.2L0 1.5h5l3.3 4.2 4.3-4.2Zm-.8 11.7h1.2L4.3 2.7H3L11.8 13.2Z" /></svg>
      </span>
    );
  }
  const mark = PLATFORM_MARK[platform] || { label: (platform || "?").slice(0, 1), aria: platform || "其他平台" };
  return (
    <span className="voice-platform-mark" aria-label={mark.aria}>{mark.label}</span>
  );
}

function cardTitle(item: VoiceCard): string {
  return (item.brief || item.title || "").trim();
}

function cardSummary(item: VoiceCard): string {
  const raw = (item.summary || item.quote || "").trim();
  const { body } = splitQuote(raw);
  const text = (body || raw).trim();
  const title = cardTitle(item);
  if (text && text !== title) return text;
  return "";
}

const CLAIMER_PREFIX = /^(帖主(?:转述|自述|介绍|提醒|转发|认为|发布|称))[：:，,\s]*/;

function coverDisplay(title: string): { coverTitle: string; prefixKind: "self" | "retold" | null; hadPrefix: boolean } {
  const raw = (title || "").trim();
  const m = raw.match(CLAIMER_PREFIX);
  if (!m) return { coverTitle: raw, prefixKind: null, hadPrefix: false };
  const rest = raw.slice(m[0].length).trim();
  if (!rest) return { coverTitle: raw, prefixKind: null, hadPrefix: false };
  return { coverTitle: rest, prefixKind: m[1].includes("自述") ? "self" : "retold", hadPrefix: true };
}

function voiceColumnCount(width: number): number {
  if (width >= 1280) return 4;
  if (width >= 768) return 3;
  return 2;
}

function titleWeight(title: string): number {
  let units = 0;
  for (const ch of title) units += ch.charCodeAt(0) > 127 ? 1 : 0.55;
  return units;
}

function estimateCardHeight(item: VoiceCard, cols: number): number {
  const raw = cardTitle(item);
  const { coverTitle, prefixKind, hadPrefix } = coverDisplay(raw);
  const unverified = !item.verified || Boolean(item.unverified_label);
  const hasBadge = unverified || (hadPrefix && Boolean(prefixKind));
  const perLine = cols >= 4 ? 14 : cols === 3 ? 16 : 11;
  const lines = Math.min(8, Math.max(1, Math.ceil(titleWeight(coverTitle) / perLine)));
  const lineHeight = cols >= 3 ? 26 : 24;
  return 26 + (hasBadge ? 22 : 0) + lines * lineHeight + 36;
}

function shortestIndex(heights: number[]): number {
  let min = 0;
  for (let i = 1; i < heights.length; i++) if (heights[i] < heights[min]) min = i;
  return min;
}

function packShortestColumns(items: VoiceCard[], cols: number): VoiceCard[][] {
  const buckets: VoiceCard[][] = Array.from({ length: cols }, () => []);
  const heights = Array.from({ length: cols }, () => 0);
  for (const item of items) {
    const i = shortestIndex(heights);
    buckets[i].push(item);
    heights[i] += estimateCardHeight(item, cols);
  }
  return buckets;
}

function skeletonHeights(count: number): number[] {
  const lines = [5, 2, 7, 3, 6, 4, 8, 2];
  return Array.from({ length: count }, (_, i) => 30 + lines[i % lines.length] * 24 + 44);
}

function placeSkeletons(itemHeights: number[], extras: number[]): number[][] {
  const cols = itemHeights.length;
  const assigned: number[][] = Array.from({ length: cols }, () => []);
  const heights = itemHeights.slice();
  extras.forEach((h, idx) => {
    const i = shortestIndex(heights);
    assigned[i].push(idx);
    heights[i] += h;
  });
  return assigned;
}

export default function VoicesPage() {
  const data = useLoaderData<typeof loader>();
  const [params, setParams] = useSearchParams();
  const [sort, setSort] = useState<SortKey>(params.get("sort") === "hot" ? "hot" : "latest");
  const [platform, setPlatform] = useState<PlatformKey>(platformFromParams(params));
  const [source, setSource] = useState<string>(sourceFromParams(params));
  const [facets, setFacets] = useState<FacetState>(facetsFromParams(params));
  const [sheet, setSheet] = useState(false);
  const [visible, setVisible] = useState(INITIAL_VISIBLE);
  const [cols, setCols] = useState<number | null>(null);
  const [items, setItems] = useState(data.items);
  const [partial, setPartial] = useState(Boolean(data.itemsPartial));
  const sentinel = useRef<HTMLDivElement>(null);
  const prefetchNow = useRef<(() => void) | null>(null);
  const filteredLen = useRef(0);
  const partialRef = useRef(Boolean(data.itemsPartial));
  const logoIndex = data.logos?.index ?? {};

  useEffect(() => {
    setItems(data.items);
    setPartial(Boolean(data.itemsPartial));
  }, [data.catalog?.generatedAt]);

  useEffect(() => {
    if (!data.itemsPartial) return;
    const ac = new AbortController();
    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      fetch("/api/site/voices", { headers: { accept: "application/json" }, signal: ac.signal })
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
        .then((full: VoicesResponse) => {
          if (!Array.isArray(full.items)) return;
          setItems(full.items);
          setPartial(false);
        })
        .catch((error: { name?: string } | undefined) => {
          if (error?.name === "AbortError") return;
        });
    };
    prefetchNow.current = start;
    // After first paint (this effect), start prefetch immediately so load-more
    // is not stuck behind requestIdleCallback under a busy main thread.
    start();
    return () => {
      ac.abort();
      prefetchNow.current = null;
    };
  }, [data.itemsPartial, data.catalog?.generatedAt]);

  const filtered = useMemo(
    () => filterVoices(items, sort, platform, source, facets),
    [items, sort, platform, source, facets],
  );
  filteredLen.current = filtered.length;
  partialRef.current = partial;

  useEffect(() => { setVisible(INITIAL_VISIBLE); }, [sort, platform, source, facets]);

  useLayoutEffect(() => {
    let raf = 0;
    const apply = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setCols(voiceColumnCount(window.innerWidth)));
    };
    apply();
    window.addEventListener("resize", apply, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", apply);
    };
  }, []);

  useEffect(() => {
    const next = new URLSearchParams();
    if (sort !== "latest") next.set("sort", sort);
    if (platform !== "all") next.set("platform", platform);
    if (source !== "all") next.set("source", source);
    (["topic", "subject", "form", "content_type", "company"] as const).forEach((k) => {
      if (facets[k].length) next.set(k, facets[k].join(","));
    });
    const a = next.toString();
    const b = params.toString();
    if (a !== b) setParams(next, { replace: true, preventScrollReset: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort, platform, source, facets]);

  const requestMore = () => {
    const have = filteredLen.current;
    const waiting = partialRef.current;
    setVisible((n) => {
      if (n < have) return Math.min(n + LOAD_MORE, have);
      if (waiting) {
        prefetchNow.current?.();
        return Math.min(n + LOAD_MORE, have + LOAD_MORE);
      }
      return n;
    });
  };

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) requestMore();
    }, { root: null, rootMargin: `${LOAD_AHEAD_PX}px 0px`, threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, [filtered.length, partial]);

  useLayoutEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    if (visible > filtered.length) return;
    if (visible >= filtered.length && !partial) return;
    if (el.getBoundingClientRect().top < window.innerHeight + LOAD_AHEAD_PX) requestMore();
  }, [visible, filtered.length, partial, cols]);

  const companyCounts = data.companyCounts ?? voiceCompanyCounts(items);
  const sourceOptions = data.sourceOptions ?? voiceSourceOptions(items);

  const maxVisible = filtered.length + (partial ? LOAD_MORE : 0);
  const shownCount = Math.min(visible, maxVisible);
  const shown = filtered.slice(0, shownCount);
  const skeletonCount = Math.max(0, shownCount - filtered.length);
  const scoped = !facetsEqualEmpty(facets) || source !== "all";
  const selected = scoped;
  const catalogTotal = data.catalogTotal ?? data.catalog.counts.total ?? items.length;
  const filteredCount = data.filteredCount ?? filtered.length;
  const label = countLabel((!partial || scoped || platform !== "all") ? (partial ? filteredCount : filtered.length) : catalogTotal, platform, scoped);
  const fetchedAt = useMemo(() => {
    if (data.dataAsOf) return data.dataAsOf;
    for (const item of filtered) {
      const text = formatFetchedAt(item.metrics?.metrics_fetched_at);
      if (text) return text;
    }
    return "";
  }, [data.dataAsOf, filtered]);

  const columns = cols ? packShortestColumns(shown, cols) : null;
  const skeletonByCol = (() => {
    if (!columns || !cols || !skeletonCount) return columns ? columns.map(() => [] as number[]) : [];
    const heights = columns.map((col) => col.reduce((sum, item) => sum + estimateCardHeight(item, cols), 0));
    return placeSkeletons(heights, skeletonHeights(skeletonCount));
  })();

  const clearAll = () => {
    setSource("all");
    setFacets(EMPTY_FACETS);
  };

  const facetRows = (
    <FacetChipRows
      vocab={data.vocab}
      value={facets}
      onChange={setFacets}
      counts={{ company: companyCounts }}
      logos={logoIndex}
      headCompanies={data.headCompanies}
    />
  );

  return (
    <div className="pb-8">
      <PhoneBar
        leading={
          <Link to="/" aria-label={`${SITE.name} 首页`} className="flex h-11 items-center pl-2.5 pr-2 text-ink">
            <Wordmark size={17} />
          </Link>
        }
        title="社区热帖"
      />
      <header className="mb-4">
        <h1 data-page-title="" className="text-[24px] font-semibold leading-[1.3] text-ink">社区热帖</h1>
        <p className="mt-2 text-[14px] leading-[1.7] text-ink-3">{label}</p>
        {fetchedAt ? <p className="mt-1 text-[12px] text-ink-4">数据截至 {fetchedAt}</p> : null}
      </header>

      {selected && (
        <div className="mb-3">
          <SelectedFacetBars
            value={facets}
            identity={source !== "all" ? { label: source, onClear: () => setSource("all") } : null}
            onToggle={(key, name) => setFacets({ ...facets, [key]: facets[key].filter((v) => v !== name) })}
            onClearAll={clearAll}
          />
        </div>
      )}

      <div className="mb-4 space-y-2.5">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <FilterRow label="排序">
              <button type="button" className={chipClass(sort === "latest")} onClick={() => setSort("latest")}>最新</button>
              <button type="button" className={chipClass(sort === "hot")} onClick={() => setSort("hot")}>最热</button>
            </FilterRow>
          </div>
          <button
            type="button"
            className={`shrink-0 ${chipClass(sheet || selected)}`}
            onClick={() => setSheet(true)}
          >
            筛选
          </button>
        </div>
        <FilterRow label="平台">
          {(["all", "小红书", "X", "中文社区"] as const).map((k) => (
            <button type="button" key={k} className={chipClass(platform === k)} onClick={() => setPlatform(k)}>
              {k === "all" ? "全部" : k}
            </button>
          ))}
        </FilterRow>
      </div>

      {sheet && (
        <div className="fixed inset-0 z-50">
          <button type="button" className="absolute inset-0 bg-black/40" aria-label="关闭筛选" onClick={() => setSheet(false)} />
          <div className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-2xl bg-surface p-4 pb-8 shadow-xl md:inset-auto md:bottom-auto md:right-6 md:top-24 md:w-[420px] md:max-h-[calc(100vh-8rem)] md:rounded-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[16px] font-semibold text-ink">筛选</h2>
              <div className="flex items-center gap-3">
                {selected ? (
                  <button type="button" className="text-[13px] text-ink-3" onClick={clearAll}>清空</button>
                ) : null}
                <button type="button" className="text-[13px] text-ink-3" onClick={() => setSheet(false)}>完成</button>
              </div>
            </div>
            <div className="mb-3">
              <FilterRow label="来源">
                <button type="button" className={chipClass(source === "all")} onClick={() => setSource("all")}>全部</button>
                {sourceOptions.map((s) => (
                  <button type="button" key={s.name} className={chipClass(source === s.name)} onClick={() => setSource(s.name)}>
                    {s.name}
                  </button>
                ))}
              </FilterRow>
            </div>
            {facetRows}
          </div>
        </div>
      )}

      {filtered.length === 0 && !partial ? (
        <EmptyState
          title="没有符合筛选的帖子"
          action={
            selected || platform !== "all" ? (
              <button
                type="button"
                className="text-[13px] text-accent hover:underline"
                onClick={() => { clearAll(); setPlatform("all"); }}
              >
                清空
              </button>
            ) : undefined
          }
        >
          试试去掉部分标签，或换个平台、来源看看。
        </EmptyState>
      ) : columns ? (
        <div className="flex items-start gap-3" data-voices-masonry="js">
          {columns.map((column, index) => (
            <div key={index} className="flex min-w-0 flex-1 flex-col gap-3">
              {column.map((item) => (
                <VoiceTile key={item.id} item={item} logoIndex={logoIndex} />
              ))}
              {(skeletonByCol[index] ?? []).map((skelIdx) => (
                <VoiceSkeleton key={`skel-${skelIdx}`} variant={skelIdx} />
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="voices-masonry" data-voices-masonry="css">
          {shown.map((item) => (
            <VoiceTile key={item.id} item={item} logoIndex={logoIndex} />
          ))}
          {Array.from({ length: skeletonCount }, (_, i) => (
            <VoiceSkeleton key={`skel-${i}`} variant={i} />
          ))}
        </div>
      )}
      <div ref={sentinel} className="h-8" data-voices-sentinel="" />
      {data.catalog.generatedAt && (
        <p className="mt-4 text-[12px] text-ink-4">目录更新于 {data.catalog.generatedAt} 北京时间 · {label}</p>
      )}
    </div>
  );
}

const VoiceTile = memo(function VoiceTile({ item, logoIndex }: { item: VoiceCard; logoIndex: Record<string, string> }) {
  const [open, setOpen] = useState(false);
  const title = cardTitle(item);
  const { coverTitle, prefixKind, hadPrefix } = coverDisplay(title);
  const summary = cardSummary(item);
  const unverified = !item.verified || Boolean(item.unverified_label);
  const unverifiedLabel = item.unverified_label || "未查到原文";
  const claimBadge = !unverified && prefixKind ? (prefixKind === "self" ? "帖主自述" : "帖主转述") : null;
  const likes = likesOf(item);
  const hideExtra = item.platform === "小红书" || isCnCommunity(item.platform);
  const source = item.source || (hideExtra ? "" : item.poster);
  const extra = engagementParts(item).filter((p) => !p.endsWith(" 赞") && !p.endsWith("赞"));
  const why = hideExtra ? "" : publicCopy(item.why);
  const companies = hideExtra ? [] : [...new Set((item.tags?.companies ?? []).map(companyChipName).filter((n): n is string => !!n))];
  const canExpand = Boolean(summary) || extra.length > 0 || Boolean(why) || companies.length > 0 || (hadPrefix && title !== coverTitle);
  return (
    <article className="card voice-card overflow-hidden" data-had-claimer-prefix={hadPrefix ? "1" : "0"} data-platform={item.platform}>
      <a
        href={item.url}
        target="_blank"
        rel="noopener noreferrer"
        className="voice-cover no-underline"
      >
        {unverified || claimBadge ? (
          <span className="voice-cover-badges">
            {unverified ? <span className="voice-badge voice-badge-unverified">{unverifiedLabel}</span> : null}
            {claimBadge ? <span className="voice-badge voice-badge-claim">{claimBadge}</span> : null}
          </span>
        ) : null}
        <h2 className="voice-cover-title">{coverTitle}</h2>
      </a>
      {open && hadPrefix && title !== coverTitle ? <p className="voice-detail">{title}</p> : null}
      {open && summary ? <p className="voice-detail">{summary}</p> : null}
      {open && why ? <p className="voice-detail">和我们的关系：{why}</p> : null}
      {open && companies.length ? (
        <div className="flex flex-wrap items-center gap-1.5 px-3 pt-2">
          {companies.map((name) => (
            <span key={name} className="inline-flex items-center gap-1 text-[11px] text-ink-4">
              <LogoMark name={name} src={logoFor(name, logoIndex)} />
              {name}
            </span>
          ))}
        </div>
      ) : null}
      {open && extra.length ? (
        <p className="flex flex-wrap gap-x-2 px-3 pt-2 text-[12px] text-ink-4">
          {extra.map((part) => <span key={part}>{part}</span>)}
        </p>
      ) : null}
      <div className="voice-meta">
        {canExpand ? (
          <button type="button" className="voice-expand" onClick={() => setOpen((v) => !v)}>
            {open ? "收起" : "展开"}
          </button>
        ) : null}
        {source ? <span className="voice-source">{source}</span> : null}
        <PlatformMark platform={item.platform} />
        {likes > 0 ? <span className="shrink-0">赞 {formatCount(likes)}</span> : null}
        <time className="ml-auto shrink-0" dateTime={item.day || undefined}>{formatDay(item.day, item.published_at)}</time>
      </div>
    </article>
  );
});

const VoiceSkeleton = memo(function VoiceSkeleton({ variant }: { variant: number }) {
  const lines = [5, 2, 7, 3, 6, 4, 8, 2][variant % 8];
  return (
    <article className="card voice-card voice-skel overflow-hidden" aria-hidden="true">
      <div className={`voice-cover voice-cover-skel voice-skel-${lines}`}>
        {Array.from({ length: lines }, (_, i) => (
          <div key={i} className="voice-skel-line" />
        ))}
      </div>
      <div className="voice-meta">
        <span className="voice-skel-chip" />
        <span className="voice-skel-chip short" />
      </div>
    </article>
  );
});
