import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useLoaderData, useSearchParams } from "react-router";
import { SITE } from "@aihot/site";
import { Wordmark } from "@aihot/site/brand/Logo.tsx";
import type { Route } from "./+types/voices";
import { cachedPage, loadOr404 } from "../lib/api.server";
import { pageReuse } from "../lib/page-reuse";
import { pageMeta } from "../lib/seo";
import { beijingToday, formatWhen } from "../lib/voice-time";
import type { Screen } from "../components/shell/screens";
import { PhoneBar } from "../components/shell/PhoneBar";
import { EmptyState } from "../components/ui/Page";
import {
  EMPTY_FACETS,
  FacetChipRows,
  SelectedFacetBars,
  companyChipName,
  facetsEqualEmpty,
  type FacetState,
  type FacetVocab,
} from "../components/facets/FacetChips";

export const handle: Screen = { tab: "featured", name: "社区热帖" };
export { pageHeaders as headers } from "../lib/api.server";
// Two expressions, not one shared binding, so the router can ship the client loader as its own tiny chunk.
export const clientLoader = pageReuse<typeof loader>().clientLoader;
export const shouldRevalidate = pageReuse<typeof loader>().shouldRevalidate;

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

function isUnverified(item: VoiceCard): boolean {
  return !item.verified || Boolean(item.unverified_label);
}

function matchesVerify(item: VoiceCard, verify: VerifyKey): boolean {
  if (verify === "all") return true;
  return verify === "verified" ? !isUnverified(item) : isUnverified(item);
}

function filterVoices(items: VoiceCard[], sort: SortKey, platform: PlatformKey, source: string, facets: FacetState, verify: VerifyKey = "all"): VoiceCard[] {
  const rows = items.filter((item) => {
    if (!matchesPlatform(item, platform)) return false;
    if (!matchesVerify(item, verify)) return false;
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
  const verify = verifyFromParams(params);
  const filtered = filterVoices(data.items, sort, platform, source, facets, verify);
  const preview = filtered.slice(0, INITIAL_VISIBLE);
  return cachedPage(60, {
    ...data,
    items: preview,
    itemsPartial: preview.length < filtered.length,
    sourceOptions: voiceSourceOptions(data.items),
    companyCounts: voiceCompanyCounts(data.items),
    railCounts: railCounts(data.items),
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
type VerifyKey = "all" | "verified" | "unverified";
type ViewKey = "cards" | "compact";

function verifyFromParams(params: URLSearchParams): VerifyKey {
  const v = params.get("verify");
  return v === "verified" || v === "unverified" ? v : "all";
}

/** Counts beside the rail's choices, over the whole catalogue (the list under a filter says its own count). */
interface RailCounts {
  total: number;
  last7: number;
  verified: number;
  platform: Record<string, number>;
  facet: Record<"topic" | "subject" | "form" | "content_type", Record<string, number>>;
}

function railCounts(items: VoiceCard[]): RailCounts {
  const out: RailCounts = { total: items.length, last7: 0, verified: 0, platform: {}, facet: { topic: {}, subject: {}, form: {}, content_type: {} } };
  const bump = (bag: Record<string, number>, key: string | undefined) => {
    if (!key) return;
    bag[key] = (bag[key] ?? 0) + 1;
  };
  for (const item of items) {
    if ((item.age_days ?? 99) <= 7) out.last7++;
    if (!isUnverified(item)) out.verified++;
    bump(out.platform, isCnCommunity(item.platform) ? "中文社区" : item.platform);
    for (const k of ["topic", "subject", "form", "content_type"] as const) bump(out.facet[k], baseLabel(item.tags?.[k]) || undefined);
  }
  return out;
}
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



function sourceFromParams(params: URLSearchParams): string {
  const direct = params.get("source");
  if (direct) return direct;
  const id = params.get("identity");
  if (id === "家长") return "家长自述";
  if (id === "老师" || id === "教师") return "教师自述";
  if (id === "学生") return "学生自述";
  return "all";
}



function splitQuote(text: string | undefined): { claim: boolean; body: string } {
  const raw = (text || "").trim();
  if (raw.startsWith("【用户自述】")) return { claim: true, body: raw.slice("【用户自述】".length) };
  return { claim: raw.includes("用户自述"), body: raw.replace(/【用户自述】/g, "") };
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
      <span className="voice-platform-mark" aria-label="X" title="X">
        <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true"><path fill="currentColor" d="M12.6 1.5h2.2L9.7 7.1 16 14.5h-4.9L7.6 9.8 3.3 14.5H1.1l5.5-6.2L0 1.5h5l3.3 4.2 4.3-4.2Zm-.8 11.7h1.2L4.3 2.7H3L11.8 13.2Z" /></svg>
      </span>
    );
  }
  const mark = PLATFORM_MARK[platform] || { label: (platform || "?").slice(0, 1), aria: platform || "其他平台" };
  return (
    <span className="voice-platform-mark" aria-label={mark.aria} title={mark.aria}>{mark.label}</span>
  );
}

/** The one title a post has: the list, the compact row and the reader all read it from here. */
function cardTitle(item: VoiceCard): string {
  const raw = (item.brief || item.title || "").trim();
  return coverDisplay(raw).coverTitle;
}

function cardSummary(item: VoiceCard): string {
  const raw = (item.summary || item.quote || "").trim();
  const { body } = splitQuote(raw);
  const text = (body || raw).trim();
  if (text && text !== cardTitle(item)) return text;
  return "";
}

const CLAIMER_PREFIX = /^(帖主(?:转述|自述|介绍|提醒|转发|认为|发布|称))[：:，,\s]*/;

function coverDisplay(title: string): { coverTitle: string; hadPrefix: boolean } {
  const raw = (title || "").trim();
  const m = raw.match(CLAIMER_PREFIX);
  if (!m) return { coverTitle: raw, hadPrefix: false };
  const rest = raw.slice(m[0].length).trim();
  if (!rest) return { coverTitle: raw, hadPrefix: false };
  return { coverTitle: rest, hadPrefix: true };
}

const UNVERIFIED_TEXT = "未核实 · 未查到原文";

function UnverifiedBadge() {
  return <span className="voice-badge-unverified">{UNVERIFIED_TEXT}</span>;
}

function tagLine(item: VoiceCard): string[] {
  const t = item.tags;
  if (!t) return [];
  return [baseLabel(t.topic), baseLabel(t.subject_raw || t.subject), baseLabel(t.content_type)]
    .filter((v) => v && v !== "不涉及" && v !== "未标明");
}

function RailGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-line-soft px-4 py-3 last:border-b-0">
      <h3 className="mb-2 text-[0.75rem] font-medium text-ink-4">{title}</h3>
      <div className="flex flex-wrap gap-2">{children}</div>
    </section>
  );
}

function RailChip({ on, count, onClick, children }: { on: boolean; count?: number; onClick: () => void; children: ReactNode }) {
  const empty = count === 0 && !on;
  return (
    <button type="button" aria-pressed={on} disabled={empty} className={chipClass(on)} onClick={onClick}>
      {children}
      {count !== undefined && <span className="num opacity-70">{count}</span>}
    </button>
  );
}

function chipClass(on: boolean): string {
  return on ? "voice-chip is-on" : "voice-chip";
}

export default function VoicesPage() {
  const data = useLoaderData<typeof loader>();
  const [params, setParams] = useSearchParams();
  const [sort, setSort] = useState<SortKey>(params.get("sort") === "hot" ? "hot" : "latest");
  const [platform, setPlatform] = useState<PlatformKey>(platformFromParams(params));
  const [source, setSource] = useState<string>(sourceFromParams(params));
  const [facets, setFacets] = useState<FacetState>(facetsFromParams(params));
  const [verify, setVerify] = useState<VerifyKey>(verifyFromParams(params));
  const [view, setView] = useState<ViewKey>(params.get("view") === "compact" ? "compact" : "cards");
  const [sheet, setSheet] = useState(false);
  const [visible, setVisible] = useState(INITIAL_VISIBLE);
  const [items, setItems] = useState(data.items);
  const [partial, setPartial] = useState(Boolean(data.itemsPartial));
  const [reading, setReading] = useState<string | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const prefetchNow = useRef<(() => void) | null>(null);
  const filteredLen = useRef(0);
  const partialRef = useRef(Boolean(data.itemsPartial));
  const logoIndex = data.logos?.index ?? {};
  const today = useMemo(() => beijingToday(), []);

  useEffect(() => {
    setItems(data.items);
    setPartial(Boolean(data.itemsPartial));
  }, [data.catalog?.generatedAt]);

  useEffect(() => {
    if (!data.itemsPartial) return;
    const ac = new AbortController();
    let started = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const need = data.filteredCount ?? data.items.length;
    const load = (attempt: number) => {
      // A cold API instance can answer with an empty catalog (cached for a minute), so retry past the cache
      // and never swap the good SSR slice for a smaller list.
      const url = attempt ? `/api/site/voices?retry=${attempt}` : "/api/site/voices";
      fetch(url, { headers: { accept: "application/json" }, signal: ac.signal })
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
        .then((full: VoicesResponse) => {
          if (!Array.isArray(full.items) || full.items.length < need) throw new Error("short catalog");
          setItems(full.items);
          setPartial(false);
        })
        .catch((error: { name?: string } | undefined) => {
          if (error?.name === "AbortError" || attempt >= 3) return;
          timer = setTimeout(() => load(attempt + 1), 800 * (attempt + 1));
        });
    };
    const start = () => {
      if (started) return;
      started = true;
      load(0);
    };
    prefetchNow.current = start;
    start();
    return () => {
      ac.abort();
      clearTimeout(timer);
      prefetchNow.current = null;
    };
  }, [data.itemsPartial, data.catalog?.generatedAt]);

  const filtered = useMemo(
    () => filterVoices(items, sort, platform, source, facets, verify),
    [items, sort, platform, source, facets, verify],
  );
  filteredLen.current = filtered.length;
  partialRef.current = partial;

  useEffect(() => { setVisible(INITIAL_VISIBLE); }, [sort, platform, source, facets, verify]);

  useEffect(() => {
    const next = new URLSearchParams();
    if (sort !== "latest") next.set("sort", sort);
    if (platform !== "all") next.set("platform", platform);
    if (source !== "all") next.set("source", source);
    if (verify !== "all") next.set("verify", verify);
    (["topic", "subject", "form", "content_type", "company"] as const).forEach((k) => {
      if (facets[k].length) next.set(k, facets[k].join(","));
    });
    if (view !== "cards") next.set("view", view);
    const a = next.toString();
    const b = params.toString();
    if (a !== b) setParams(next, { replace: true, preventScrollReset: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort, platform, source, facets, verify, view]);

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
  }, [visible, filtered.length, partial]);

  const companyCounts = data.companyCounts ?? voiceCompanyCounts(items);
  const sourceOptions = data.sourceOptions ?? voiceSourceOptions(items);
  const counts: RailCounts = useMemo(() => (partial && data.railCounts ? data.railCounts : railCounts(items)), [partial, data.railCounts, items]);

  const maxVisible = filtered.length + (partial ? LOAD_MORE : 0);
  const shownCount = Math.min(visible, maxVisible);
  const shown = filtered.slice(0, shownCount);
  const skeletonCount = Math.max(0, Math.min(shownCount - filtered.length, 4));
  const scoped = !facetsEqualEmpty(facets) || source !== "all" || verify !== "all" || platform !== "all";
  const matchCount = partial ? (data.filteredCount ?? filtered.length) : filtered.length;
  const fetchedAt = useMemo(() => {
    if (data.dataAsOf) return data.dataAsOf;
    for (const item of items) {
      const text = formatFetchedAt(item.metrics?.metrics_fetched_at);
      if (text) return text;
    }
    return "";
  }, [data.dataAsOf, items]);

  const clearAll = () => {
    setSource("all");
    setFacets(EMPTY_FACETS);
    setVerify("all");
    setPlatform("all");
  };

  const readingIndex = reading ? filtered.findIndex((v) => v.id === reading) : -1;
  const readingItem = readingIndex >= 0 ? filtered[readingIndex] : null;
  const openReader = useCallback((id: string) => setReading(id), []);

  const toggleFacet = (key: "topic" | "subject" | "form" | "content_type", name: string) =>
    setFacets((f) => ({ ...f, [key]: f[key].includes(name) ? f[key].filter((v) => v !== name) : [...f[key], name] }));

  const rail = (
    <>
      <RailGroup title="排序">
        <RailChip on={sort === "latest"} onClick={() => setSort("latest")}>最新</RailChip>
        <RailChip on={sort === "hot"} onClick={() => setSort("hot")}>近 7 天最热</RailChip>
      </RailGroup>
      <RailGroup title="平台">
        {(["all", "小红书", "X", "中文社区"] as const).map((k) => (
          <RailChip key={k} on={platform === k} count={k === "all" ? counts.total : (counts.platform[k] ?? 0)} onClick={() => setPlatform(k)}>
            {k === "all" ? "全部" : k}
          </RailChip>
        ))}
      </RailGroup>
      <RailGroup title="核实状态">
        <RailChip on={verify === "all"} count={counts.total} onClick={() => setVerify("all")}>全部</RailChip>
        <RailChip on={verify === "verified"} count={counts.verified} onClick={() => setVerify("verified")}>已核实原文</RailChip>
        <RailChip on={verify === "unverified"} count={counts.total - counts.verified} onClick={() => setVerify("unverified")}>未核实</RailChip>
      </RailGroup>
      <RailGroup title="来源">
        <RailChip on={source === "all"} onClick={() => setSource("all")}>全部</RailChip>
        {sourceOptions.map((s) => (
          <RailChip key={s.name} on={source === s.name} count={s.count} onClick={() => setSource(source === s.name ? "all" : s.name)}>{s.name}</RailChip>
        ))}
      </RailGroup>
      {(["topic", "subject", "form", "content_type"] as const).map((key) => (
        <RailGroup key={key} title={{ topic: "主题", subject: "学科能力", form: "形态", content_type: "内容类型" }[key]}>
          {(data.vocab[key] ?? []).map((name) => (
            <RailChip key={name} on={facets[key].includes(name)} count={counts.facet[key][name] ?? 0} onClick={() => toggleFacet(key, name)}>{name}</RailChip>
          ))}
        </RailGroup>
      ))}
      <div className="px-4 py-3">
        <FacetChipRows
          vocab={{ topic: [], subject: [], form: [], content_type: [] }}
          value={facets}
          onChange={(next) => setFacets({ ...facets, company: next.company })}
          counts={{ company: companyCounts }}
          logos={logoIndex}
          headCompanies={data.headCompanies}
          onlyCompany
        />
      </div>
    </>
  );

  return (
    <div className="pb-8">
      <PhoneBar
        leading={
          <Link to="/" aria-label={`${SITE.name} 首页`} className="flex h-11 items-center pl-3 pr-2 text-ink">
            <Wordmark size={16} />
          </Link>
        }
        title="社区热帖"
        actions={
          <button type="button" className="mr-2 inline-flex h-8 items-center rounded-full px-3 text-[0.875rem] text-accent" onClick={() => setSheet(true)}>
            筛选{scoped ? " · 已选" : ""}
          </button>
        }
      />
      <header className="mb-3 lg:mb-4">
        <h1 data-page-title="" className="text-[1.75rem] font-semibold leading-[1.3] text-ink">社区热帖</h1>
        <p className="mt-1 hidden text-[0.875rem] leading-[1.7] text-ink-3 lg:block">
          X、小红书和中文社区里的真实讨论。先看站内摘要，再决定要不要去原帖。
        </p>
        <p className="mt-1 text-[0.75rem] text-ink-4">
          共 <span className="num">{counts.total}</span> 条 · 近 7 天 <span className="num">{counts.last7}</span> 条 · 已核实原文 <span className="num">{counts.verified}</span> 条
          {fetchedAt ? ` · 数据截至 ${fetchedAt}` : ""}
        </p>
      </header>

      <div className="voices-layout">
        <aside className="voices-rail scrollbar-thin" aria-label="筛选">
          {rail}
        </aside>

        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="text-[0.875rem] text-ink-2"><span className="num font-semibold text-ink">{matchCount}</span> 条{scoped ? "符合筛选" : ""}</span>
            {scoped ? (
              <SelectedFacetBars
                value={facets}
                identity={[
                  platform !== "all" ? platform : null,
                  verify !== "all" ? (verify === "verified" ? "已核实原文" : "未核实") : null,
                  source !== "all" ? source : null,
                ].filter(Boolean).length ? { label: [platform !== "all" ? platform : null, verify !== "all" ? (verify === "verified" ? "已核实原文" : "未核实") : null, source !== "all" ? source : null].filter(Boolean).join(" · "), onClear: () => { setPlatform("all"); setVerify("all"); setSource("all"); } } : null}
                onToggle={(key, name) => setFacets({ ...facets, [key]: facets[key].filter((v) => v !== name) })}
                onClearAll={clearAll}
              />
            ) : null}
            <div className="ml-auto inline-flex rounded-full bg-surface p-1 ring-1 ring-inset ring-line" role="group" aria-label="视图">
              {(["cards", "compact"] as const).map((v) => (
                <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={`h-8 rounded-full px-3 text-[0.75rem] transition-colors active:scale-[0.97] ${view === v ? "bg-accent text-accent-contrast" : "text-ink-3 hover:text-ink"}`}>
                  {v === "cards" ? "卡片" : "紧凑列表"}
                </button>
              ))}
            </div>
          </div>

          {filtered.length === 0 && !partial ? (
            <div className="card">
              <EmptyState
                title="没有符合筛选的帖子"
                action={scoped ? <button type="button" className="text-[0.875rem] text-accent hover:underline" onClick={clearAll}>清空筛选</button> : undefined}
              >
                试试去掉部分条件，或换个平台、来源看看。
              </EmptyState>
            </div>
          ) : view === "compact" ? (
            <ol className="card divide-y divide-line-soft overflow-hidden" data-voices-view="compact">
              {shown.map((item, i) => (
                <VoiceRow key={item.id} item={item} today={today} index={i} onOpen={openReader} />
              ))}
            </ol>
          ) : (
            <div className="voices-grid" data-voices-view="cards">
              {shown.map((item) => (
                <VoiceTile key={item.id} item={item} today={today} onOpen={openReader} />
              ))}
              {Array.from({ length: skeletonCount }, (_, i) => (
                <VoiceSkeleton key={`skel-${i}`} />
              ))}
            </div>
          )}
          <div ref={sentinel} className="h-8" data-voices-sentinel="" />
          {data.catalog.generatedAt && (
            <p className="mt-4 text-[0.75rem] text-ink-4">目录更新于 {data.catalog.generatedAt} 北京时间</p>
          )}
        </div>
      </div>

      {sheet && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button type="button" className="absolute inset-0 bg-black/40" aria-label="关闭筛选" onClick={() => setSheet(false)} />
          <div className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-2xl bg-surface pb-8 shadow-xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line-soft bg-surface px-4 py-3">
              <h2 className="text-[1rem] font-semibold text-ink">筛选</h2>
              <div className="flex items-center gap-2">
                {scoped ? <button type="button" className="h-8 px-2 text-[0.875rem] text-ink-3" onClick={clearAll}>清空</button> : null}
                <button type="button" className="h-8 px-2 text-[0.875rem] font-medium text-accent" onClick={() => setSheet(false)}>完成</button>
              </div>
            </div>
            {rail}
          </div>
        </div>
      )}

      {readingItem && (
        <VoiceReader
          item={readingItem}
          index={readingIndex}
          total={matchCount}
          today={today}
          onClose={() => setReading(null)}
          onStep={(by) => {
            const next = filtered[readingIndex + by];
            if (next) setReading(next.id);
            if (readingIndex + by >= shownCount - 2) requestMore();
          }}
          hasPrev={readingIndex > 0}
          hasNext={readingIndex < filtered.length - 1}
        />
      )}
    </div>
  );
}

const VoiceTile = memo(function VoiceTile({ item, today, onOpen }: { item: VoiceCard; today: string; onOpen: (id: string) => void }) {
  const title = cardTitle(item);
  const summary = cardSummary(item);
  const unverified = isUnverified(item);
  const likes = likesOf(item);
  const replies = metricOf(item, "replies");
  const tags = tagLine(item);
  const who = item.platform === "X" ? item.author : item.source || item.poster;
  return (
    <article className="card card-press voice-card" data-platform={item.platform} data-unverified={unverified ? "1" : "0"}>
      <div className="voice-card-head">
        <PlatformMark platform={item.platform} />
        <span className="min-w-0 truncate">{who}{item.platform === "X" && item.source ? ` · ${item.source}` : ""}</span>
        {unverified ? <UnverifiedBadge /> : null}
        <time className="ml-auto shrink-0 num" dateTime={item.published_at || item.day || undefined}>{formatWhen(item, today)}</time>
      </div>
      <h2 className="voice-card-title">
        <a href={`#${item.id}`} onClick={(e) => { e.preventDefault(); onOpen(item.id); }} className="after:absolute after:inset-0 after:content-['']">
          {title}
        </a>
      </h2>
      {summary ? <p className="voice-card-summary">{summary}</p> : null}
      <div className="voice-card-foot">
        {tags.length ? <span className="min-w-0 truncate">{tags.join(" · ")}</span> : null}
        {likes > 0 ? <span className="shrink-0">赞 {formatCount(likes)}</span> : null}
        {replies > 0 ? <span className="shrink-0">回复 {formatCount(replies)}</span> : null}
        <span className="ml-auto shrink-0 font-medium text-accent">读摘要 →</span>
      </div>
    </article>
  );
});

const VoiceRow = memo(function VoiceRow({ item, today, index, onOpen }: { item: VoiceCard; today: string; index: number; onOpen: (id: string) => void }) {
  const unverified = isUnverified(item);
  const likes = likesOf(item);
  return (
    <li className="voice-row relative" data-platform={item.platform} data-index={index}>
      <PlatformMark platform={item.platform} />
      <a href={`#${item.id}`} onClick={(e) => { e.preventDefault(); onOpen(item.id); }} className="voice-row-title after:absolute after:inset-0 after:content-['']">
        {cardTitle(item)}
      </a>
      {unverified ? <UnverifiedBadge /> : null}
      <span className="voice-row-meta">
        {likes > 0 ? <span>赞 {formatCount(likes)}</span> : null}
        <time className="num" dateTime={item.published_at || item.day || undefined}>{formatWhen(item, today)}</time>
      </span>
    </li>
  );
});

function VoiceReader({ item, index, total, today, onClose, onStep, hasPrev, hasNext }: {
  item: VoiceCard;
  index: number;
  total: number;
  today: string;
  onClose: () => void;
  onStep: (by: number) => void;
  hasPrev: boolean;
  hasNext: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const unverified = isUnverified(item);
  const summary = cardSummary(item);
  const tags = item.tags;
  const host = (() => {
    try { return new URL(item.url).hostname.replace(/^www\./, ""); } catch { return ""; }
  })();
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    const restore = document.activeElement as HTMLElement | null;
    return () => restore?.focus?.();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" && hasPrev) onStep(-1);
      if (e.key === "ArrowRight" && hasNext) onStep(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hasPrev, hasNext, onStep]);
  const stats = ENGAGEMENT_PARTS.map(({ key, label }) => ({ label, n: metricOf(item, key) })).filter((s) => s.n > 0);
  const facts = tags ? [
    ["主题", baseLabel(tags.topic)],
    ["学科", baseLabel(tags.subject_raw || tags.subject)],
    ["类型", baseLabel(tags.content_type)],
  ].filter(([, v]) => v && v !== "不涉及" && v !== "未标明") : [];
  return (
    <dialog
      ref={ref}
      className="voice-reader"
      aria-labelledby="voice-reader-title"
      onClose={onClose}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="voice-reader-panel">
        <div className="flex items-center gap-3 border-b border-line-soft px-5 py-3">
          <span className="text-[0.75rem] text-ink-4">站内摘要 · 第 <span className="num">{index + 1}</span> / <span className="num">{total}</span> 条</span>
          <button type="button" onClick={onClose} className="ml-auto inline-flex h-8 items-center rounded-full px-3 text-[0.875rem] text-ink-3 ring-1 ring-inset ring-line hover:text-ink active:scale-[0.97]">
            关闭
          </button>
        </div>
        <div className="voice-reader-body">
          <div className="flex flex-wrap items-center gap-2 text-[0.75rem] text-ink-4">
            <PlatformMark platform={item.platform} />
            <span>{item.platform === "X" ? item.author : item.source || item.poster}{item.platform === "X" && item.source ? ` · ${item.source}` : ""}</span>
            {unverified ? <UnverifiedBadge /> : <span className="text-accent">已核对原文</span>}
            <time className="ml-auto num" dateTime={item.published_at || item.day || undefined}>{formatWhen(item, today, true)}</time>
          </div>
          <h2 id="voice-reader-title" className="mt-3 text-[1.25rem] font-semibold leading-[1.5] text-ink">{cardTitle(item)}</h2>
          {summary ? (
            <div className="mt-4 rounded-card border-l-4 border-accent bg-bg px-4 py-3">
              <div className="mb-1 text-[0.75rem] text-ink-4">站内摘要</div>
              <p className="text-[1rem] leading-[1.75] text-ink-2">{summary}</p>
            </div>
          ) : null}
          {facts.length ? (
            <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[0.875rem]">
              {facts.map(([k, v]) => (
                <div key={k} className="contents"><dt className="text-ink-4">{k}</dt><dd className="text-ink-2">{v}</dd></div>
              ))}
            </dl>
          ) : null}
          {stats.length ? (
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {stats.slice(0, 4).map((s) => (
                <div key={s.label} className="rounded-control bg-bg px-3 py-2">
                  <div className="text-[0.75rem] text-ink-4">{s.label}</div>
                  <div className="num text-[1rem] font-semibold text-ink">{formatCount(s.n)}</div>
                </div>
              ))}
            </div>
          ) : null}
          <p className="mt-4 text-[0.75rem] leading-[1.7] text-ink-4">
            {unverified
              ? "这条还没打开原帖核对，摘要里的数字和说法以原帖为准。"
              : "「已核对原文」指站内打开过原帖、核对了摘要里的说法。这里是站内整理，不是原文全文。"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-line-soft px-5 py-3">
          <button type="button" disabled={!hasPrev} onClick={() => onStep(-1)} className="h-8 rounded-full px-3 text-[0.875rem] text-ink-2 hover:text-ink disabled:opacity-40 active:scale-[0.97]">← 上一条</button>
          <button type="button" disabled={!hasNext} onClick={() => onStep(1)} className="h-8 rounded-full px-3 text-[0.875rem] text-ink-2 hover:text-ink disabled:opacity-40 active:scale-[0.97]">下一条 →</button>
          <button type="button" onClick={onClose} className="ml-auto h-8 rounded-full px-3 text-[0.875rem] text-ink-2 ring-1 ring-inset ring-line hover:text-ink active:scale-[0.97]">返回列表</button>
          <a href={item.url} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1 rounded-full bg-accent px-4 text-[0.875rem] font-medium text-accent-contrast active:scale-[0.97]">
            查看原帖{host ? <span className="text-[0.75rem] opacity-80">{host}</span> : null} ↗
          </a>
        </div>
      </div>
    </dialog>
  );
}

function VoiceSkeleton() {
  return (
    <article className="card voice-card voice-skel" aria-hidden="true">
      <div className="voice-skel-line" />
      <div className="voice-skel-line" />
      <div className="voice-skel-line" />
    </article>
  );
}
