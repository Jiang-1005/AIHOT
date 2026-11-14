// Feed filters: the channel and category choice (a row of tabs on desktop, a sheet behind the bar's filter
// button on phones), the phone bar of 精选 and 全部, and search.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Form, Link, useNavigate, useNavigation, useSearchParams } from "react-router";
import { CATEGORY_LABELS, CHANNEL_LABELS, type CategoryKey, type ChannelKey } from "@aihot/contracts/taxonomy";
import { SITE } from "@aihot/site";
import { IconClose, IconFilter, IconSearch } from "../../components/icons";
import { PillTabs } from "../../components/ui/Tabs";
import { Sheet } from "../../components/ui/Sheet";
import { Wordmark } from "@aihot/site/brand/Logo.tsx";
import { BarButton, PhoneBar } from "../../components/shell/PhoneBar";
import { openSearch } from "../search/SearchOverlay";
import { EMPTY_FACETS, FacetChipRows, SelectedFacetBars, facetsEqualEmpty, facetsFromRecord, type FacetState, type FacetsMeta } from "../../components/facets/FacetChips";
import { facetParams, facetsActive, readFacets } from "../../lib/seo";

/** Same page with some query parameters changed (paging state dropped). */
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

function currentFacets(params: URLSearchParams): FacetState {
  return facetsFromRecord(readFacets(params));
}

function patchFacets(base: string, params: URLSearchParams, next: FacetState): string {
  return hrefWith(base, params, facetParams(next));
}

/** Desktop: five-dimension chip rows, replacing the old 一手/能力/产品… tabs. */
export function DesktopFacetBlock({
  base, title, blurb, meta, search,
}: {
  base: string;
  title: ReactNode;
  blurb?: ReactNode;
  meta: FacetsMeta;
  search?: ReactNode;
}) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const value = currentFacets(params);
  return (
    <div className="hidden lg:block">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[24px] font-semibold leading-[1.3] text-ink">{title}</h1>
          {blurb}
        </div>
        {search}
      </div>
      <div className="mb-5">
        <FacetChipRows
          vocab={meta.vocab}
          value={value}
          onChange={(next) => navigate(patchFacets(base, params, next), { preventScrollReset: true })}
          counts={meta.counts}
          logos={meta.logos?.index}
          headCompanies={meta.headCompanies}
        />
      </div>
    </div>
  );
}

/**
 * The phone bar of 精选, 往期 and 全部: the brand, the switch (a filter in use carries over), and
 * buttons for the filter sheet and search.
 */
export function FeedBar({ base, category, channel, meta }: { base: "/" | "/archive" | "/all"; category: CategoryKey | null; channel: ChannelKey; meta?: FacetsMeta }) {
  const [params] = useSearchParams();
  const [sheet, setSheet] = useState(false);
  const scope = (to: string) => hrefWith(to, params, { q: null, tab: null, search: null, slot: null });
  const filtered = facetsActive(readFacets(params)) || channel === "firstParty" || !!category;
  const active = base === "/" ? "featured" : base === "/archive" ? "archive" : "all";
  return (
    <>
      <PhoneBar
        leading={
          <Link to="/" aria-label={`${SITE.name} 首页`} className="flex h-11 items-center pl-2.5 pr-2 text-ink">
            <Wordmark size={17} />
          </Link>
        }
        center={
          <PillTabs
            size="sm"
            layoutId="feed-scope"
            label="看精选、往期或全部"
            active={active}
            items={[
              { key: "featured", label: "精选", to: scope("/"), resetScroll: true, prefetchOnPress: true },
              { key: "archive", label: "往期", to: scope("/archive"), resetScroll: true, prefetchOnPress: true },
              { key: "all", label: "全部", to: scope("/all"), resetScroll: true, prefetchOnPress: true },
            ]}
          />
        }
        actions={
          <>
            <BarButton label={filtered ? "筛选（已选）" : "筛选"} on={filtered} onClick={() => setSheet(true)}>
              <IconFilter size={21} />
              {filtered && <span aria-hidden="true" className="absolute right-[9px] top-[9px] size-[7px] rounded-full bg-accent ring-2 ring-bg" />}
            </BarButton>
            <SearchButton />
          </>
        }
      />
      <FilterSheet open={sheet} onClose={() => setSheet(false)} base={base} meta={meta} />
    </>
  );
}

/** Phones: the five-dimension filters in a sheet; 完成 applies them. */
function FilterSheet({ open, onClose, base, meta }: { open: boolean; onClose: () => void; base: string; meta?: FacetsMeta }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<FacetState>(currentFacets(params));
  const [loaded, setLoaded] = useState<FacetsMeta | undefined>(meta);
  useEffect(() => {
    if (open) setDraft(currentFacets(params));
  }, [open, params]);
  useEffect(() => {
    if (meta) { setLoaded(meta); return; }
    if (!open || loaded) return;
    let gone = false;
    fetch("/api/site/facets")
      .then((r) => r.json())
      .then((d) => { if (!gone) setLoaded(d); })
      .catch(() => undefined);
    return () => { gone = true; };
  }, [open, meta, loaded]);
  const apply = (next: FacetState) => {
    navigate(patchFacets(base, params, next), { preventScrollReset: true });
    onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} title="筛选">
      <div className="px-4 pb-6">
        <div className="mb-3 flex items-center justify-end gap-3">
          <button type="button" className="text-[13px] text-ink-3" onClick={() => setDraft(EMPTY_FACETS)}>清空</button>
          <button type="button" className="text-[13px] font-medium text-accent" onClick={() => apply(draft)}>完成</button>
        </div>
        {loaded ? (
          <FacetChipRows
            vocab={loaded.vocab}
            value={draft}
            onChange={setDraft}
            counts={loaded.counts}
            logos={loaded.logos?.index}
            headCompanies={loaded.headCompanies}
          />
        ) : (
          <p className="py-6 text-center text-[13px] text-ink-4">加载筛选…</p>
        )}
      </div>
    </Sheet>
  );
}

/** Phones: the filter and tag in use as chips under the bar; each one clears itself when tapped. */
export function ActiveFilters({ base, category, channel, tag }: { base: string; category: CategoryKey | null; channel: ChannelKey; tag: string | null }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const facets = currentFacets(params);
  const label = channel === "firstParty" ? CHANNEL_LABELS.firstParty : category ? CATEGORY_LABELS[category] : null;
  const hasFacets = !facetsEqualEmpty(facets);
  if (!label && !tag && !hasFacets) return null;
  const chip = "inline-flex min-h-11 max-w-full items-center gap-1 rounded-full bg-accent-soft pl-3 pr-2 text-[13px] font-medium text-accent transition-opacity active:opacity-60";
  return (
    <div className="flex flex-wrap items-center gap-2 pb-3 pt-1 lg:hidden">
      {label && (
        <Link to={hrefWith(base, params, { category: null, channel: null })} aria-label={`取消筛选：${label}`} className={chip}>
          只看{label}
          <IconClose size={14} strokeWidth={2} />
        </Link>
      )}
      {tag && (
        <Link to={hrefWith(base, params, { tag: null })} aria-label={`取消标签：${tag}`} className={chip}>
          <span className="truncate">#{tag}</span>
          <IconClose size={14} strokeWidth={2} className="shrink-0" />
        </Link>
      )}
      {hasFacets && (
        <SelectedFacetBars
          value={facets}
          onToggle={(key, name) => navigate(patchFacets(base, params, { ...facets, [key]: facets[key].filter((v) => v !== name) }), { preventScrollReset: true })}
          onClearAll={() => navigate(patchFacets(base, params, EMPTY_FACETS), { preventScrollReset: true })}
        />
      )}
    </div>
  );
}

/** Phones: the magnifier in a bar; the search opens over the page with the keyboard up. */
function SearchButton() {
  return (
    <BarButton label="搜索" onClick={(event) => openSearch("", event.currentTarget)}>
      <IconSearch size={21} />
    </BarButton>
  );
}

function useSlashFocus(ref: React.RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || (e.target as HTMLElement)?.isContentEditable)) {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ref]);
}

/** Desktop search field (GET /all?q=…): at the end of the filter row as the same grey track, at the height of md tabs, with a "/" hint. */
export function SearchField({ defaultValue = "", keep = {} }: { defaultValue?: string; keep?: Record<string, string | null> }) {
  const [value, setValue] = useState(defaultValue);
  const navigation = useNavigation();
  const [params] = useSearchParams();
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => setValue(defaultValue), [defaultValue]);
  useSlashFocus(inputRef);
  const searching = navigation.state === "loading" && navigation.location?.pathname === "/all" && !!new URLSearchParams(navigation.location.search).get("q");
  const hiddenKeep = { ...facetParams(readFacets(params)), ...keep };
  const hidden = Object.entries(hiddenKeep).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null));

  return (
    <Form method="get" action="/all" role="search" className="group relative w-full shrink-0 lg:w-60">
      {hidden}
      <label htmlFor="site-search" className="sr-only">
        搜索标题和摘要
      </label>
      <IconSearch size={16} className={`pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 transition-colors ${searching ? "text-accent" : "text-ink-4 group-focus-within:text-ink-3"}`} />
      <input
        ref={inputRef}
        id="site-search"
        name="q"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="搜索标题、摘要…"
        maxLength={200}
        autoComplete="off"
        className="h-[42px] w-full rounded-full bg-well pl-10 pr-10 text-[16px] text-ink outline-none ring-1 ring-inset ring-line-soft transition-[background-color,box-shadow] placeholder:text-ink-4 hover:ring-line-strong focus:bg-surface focus:shadow-[0_0_0_3px_var(--accent-soft)] focus:ring-accent sm:text-[14px]"
      />
      {value ? (
        <button
          type="button"
          aria-label="清空"
          onClick={() => {
            setValue("");
            inputRef.current?.focus();
          }}
          className="absolute right-3 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-full text-ink-4 transition-colors hover:bg-bg-sunk hover:text-ink"
        >
          <IconClose size={13} />
        </button>
      ) : (
        <kbd className="mono pointer-events-none absolute right-4 top-1/2 hidden -translate-y-1/2 rounded-mark border border-line-strong bg-surface px-1.5 text-[10.5px] leading-4 text-ink-4 lg:block">/</kbd>
      )}
    </Form>
  );
}
