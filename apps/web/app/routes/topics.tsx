import { useState } from "react";
import { Link, useLoaderData, useNavigate, useSearchParams } from "react-router";
import { SITE } from "@aihot/site";
import { Wordmark } from "@aihot/site/brand/Logo.tsx";
import type { Route } from "./+types/topics";
import type { TimelineResponse } from "@aihot/contracts/site";
import { apiGet, cachedPage, loadOr404 } from "../lib/api.server";
import { pageReuse } from "../lib/page-reuse";
import { facetParams, filterParams, hasFeedFilters, itemListLd, listPath, pageMeta, readFilters, timelineApiParams } from "../lib/seo";
import type { Screen } from "../components/shell/screens";
import { navUp } from "../components/shell/nav";
import { PhoneBar } from "../components/shell/PhoneBar";
import type { FacetsMeta } from "../components/facets/FacetChips";
import { EMPTY_FACETS, FacetChipRows, SelectedFacetBars, facetsEqualEmpty, facetsFromRecord } from "../components/facets/FacetChips";
import { Timeline } from "../features/feed/Timeline";
import { ToggleChip } from "../components/ui/Controls";
import { setUnreadOnly, useUnreadOnly } from "../lib/local-state";

export const handle: Screen = { home: navUp("/topics").tab, name: "主题" };
export { pageHeaders as headers } from "../lib/api.server";
export const { clientLoader, shouldRevalidate } = pageReuse<typeof loader>();

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const filters = { ...readFilters(url.searchParams), slot: (url.searchParams.get("slot") === "archive" ? "archive" : "featured") as "featured" | "archive" };
  const upstream = new Headers();
  const [data, facets] = await Promise.all([
    loadOr404<TimelineResponse>(listPath("/api/site/timeline", timelineApiParams(filters)), { responseHeaders: upstream, signal: request.signal }),
    apiGet<FacetsMeta>("/api/site/facets", { responseHeaders: upstream, signal: request.signal }),
  ]);
  return cachedPage(60, { data, filters, facets }, upstream);
}

export function meta({ loaderData }: Route.MetaArgs) {
  const filters = loaderData?.filters;
  const path = listPath("/topics", filters ? { ...filterParams(filters), slot: filters.slot === "archive" ? "archive" : null } : {});
  const titles = loaderData?.data.cards.map((c) => c.item.title) ?? [];
  return pageMeta({
    title: SITE.topicsTitle ?? "主题",
    description: "按主题、学科能力、公司与产品、形态和内容类型浏览媒体精选与往期报道。",
    path,
    noindex: hasFeedFilters(filters) || filters?.slot === "archive",
    jsonLd: path === "/topics" ? itemListLd("/topics", "主题", titles) : undefined,
  });
}

function hrefWith(base: string, params: URLSearchParams, patch: Record<string, string | null>) {
  const sp = new URLSearchParams(params);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === "") sp.delete(k);
    else sp.set(k, v);
  }
  sp.delete("page");
  sp.delete("cursor");
  const s = sp.toString();
  return s ? `${base}?${s}` : base;
}

export default function TopicsPage() {
  const { data, filters, facets } = useLoaderData<typeof loader>();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const slot = filters.slot === "archive" ? "archive" : "featured";
  const value = facetsFromRecord(filters);
  const selected = !facetsEqualEmpty(value);
  const [sheet, setSheet] = useState(false);
  const unreadOnly = useUnreadOnly();
  const chip = (on: boolean) => `inline-flex rounded-full px-2.5 py-1 text-[12px] ${on ? "bg-ink text-white" : "bg-bg-sunk text-ink-2"}`;

  const facetRows = (
    <FacetChipRows
      vocab={facets.vocab}
      value={value}
      onChange={(next) => navigate(hrefWith("/topics", params, facetParams(next)), { preventScrollReset: true })}
      counts={facets.counts}
      logos={facets.logos?.index}
      headCompanies={facets.headCompanies}
    />
  );

  return (
    <div className="pb-6">
      <PhoneBar
        leading={
          <Link to="/" aria-label={`${SITE.name} 首页`} className="flex h-11 items-center pl-2.5 pr-2 text-ink">
            <Wordmark size={17} />
          </Link>
        }
        title="主题"
      />
      <header className="pb-2 pt-3 lg:pt-1">
        <h1 data-page-title="" className="text-[24px] font-semibold leading-[1.3] text-ink">主题</h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-3">按五组标签浏览媒体精选与往期报道。</p>
      </header>

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          className={chip(slot === "featured")}
          onClick={() => navigate(hrefWith("/topics", params, { slot: null }), { preventScrollReset: true })}
        >
          精选
        </button>
        <button
          type="button"
          className={chip(slot === "archive")}
          onClick={() => navigate(hrefWith("/topics", params, { slot: "archive" }), { preventScrollReset: true })}
        >
          往期
        </button>
        <div className="md:hidden">
          <ToggleChip size="sm" on={unreadOnly} onToggle={() => setUnreadOnly(!unreadOnly)}>只看未读</ToggleChip>
        </div>
        <button
          type="button"
          className={`md:hidden ${chip(sheet || selected)}`}
          onClick={() => setSheet(true)}
        >
          筛选
        </button>
      </div>

      {selected && (
        <div className="mb-3">
          <SelectedFacetBars
            value={value}
            onToggle={(key, name) => navigate(hrefWith("/topics", params, facetParams({ ...value, [key]: value[key].filter((v) => v !== name) })), { preventScrollReset: true })}
            onClearAll={() => navigate(hrefWith("/topics", params, facetParams(EMPTY_FACETS)), { preventScrollReset: true })}
          />
        </div>
      )}

      <div className="mb-5 hidden md:block">{facetRows}</div>

      {sheet && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button type="button" className="absolute inset-0 bg-black/40" aria-label="关闭筛选" onClick={() => setSheet(false)} />
          <div className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-2xl bg-surface p-4 pb-8 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[16px] font-semibold text-ink">筛选</h2>
              <button type="button" className="text-[13px] text-ink-3" onClick={() => setSheet(false)}>完成</button>
            </div>
            {facetRows}
          </div>
        </div>
      )}

      <Timeline
        initial={data}
        filters={filters}
        hidePhoneUnread
        emptyTitle="没有符合筛选的报道"
        emptyHint="试试去掉部分标签，或换到另一段（精选 / 往期）。"
      />
    </div>
  );
}
