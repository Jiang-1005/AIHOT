// Universal search: full-screen sheet on phones (< 700px) opening with the keyboard already up
// — the field is focused inside the tap, which iOS requires — and a centered Command-K Spotlight
// palette on desktop (>= 700px). Searches 全部动态 (/all?q=…) with quick jumps, recent searches,
// topics to browse and what is hot now.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Form, Link, useLocation, useNavigation } from "react-router";
import type { SearchSuggestions } from "@aihot/contracts/site";
import { IconClose, IconSearch } from "../../components/icons";
import { inNav } from "../../components/shell/nav";
import { addRecentSearch, clearRecentSearches, useRecentSearches } from "../../lib/local-state";
import { useModal } from "../../components/ui/modal";

// One overlay for the whole site, opened from any bar or ⌘K / Ctrl+K.
let overlay: HTMLDivElement | null = null;
let field: HTMLInputElement | null = null;
const opener: { current: HTMLElement | null } = { current: null };
let open = false;
let openedAt = "default";
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
function setOpen(next: boolean) {
  open = next;
  for (const l of listeners) l();
}

/** Opens the search over the page; call it from the tap itself so the keyboard comes up. */
export function openSearch(query = "", trigger?: HTMLElement) {
  if (!open) opener.current = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  openedAt = (window.history.state as { key?: string } | null)?.key ?? "default";
  if (overlay && field) {
    overlay.inert = false; // closed, it is inert, and nothing inside an inert overlay takes focus
    field.value = query;
    field.focus({ preventScroll: true });
  }
  setOpen(true);
}

let suggestions: Promise<SearchSuggestions> | null = null;

/** Share only an ongoing read; the HTTP cache owns freshness and failed reads can be retried. */
function loadSuggestions() {
  suggestions ??= fetch('/api/site/search/suggestions')
    .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json() as Promise<SearchSuggestions>; })
    .finally(() => { suggestions = null; });
  return suggestions;
}

const RANK_COLOR = ["text-rank-1", "text-rank-2", "text-rank-3"];

const QUICK_JUMPS = [
  { to: "/", label: "精选" },
  { to: "/hot", label: "热点榜" },
  { to: "/voices", label: "社区热帖" },
  { to: "/companies", label: "国内公司动态" },
  { to: "/policies", label: "国内政策" },
  { to: "/daily", label: "日报" },
  { to: "/all", label: "全部动态" },
];

export function SearchOverlay() {
  const shown = useSyncExternalStore(subscribe, () => open, () => false);
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  // The field is uncontrolled: openSearch() fills and focuses it inside the tap, before React renders.
  const [hasText, setHasText] = useState(false);
  const recent = useRecentSearches();
  const navigation = useNavigation();
  const { key } = useLocation();
  const [more, setMore] = useState<Awaited<ReturnType<typeof loadSuggestions>> | null>(null);

  useModal({ open: shown, panel, initialFocus: input, returnFocus: opener, onClose: close });

  useEffect(() => {
    overlay = panel.current;
    field = input.current;
    return () => {
      overlay = null;
      field = null;
      setOpen(false);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (open) close();
        else openSearch("");
        return;
      }
      if (
        e.key === "/" &&
        !open &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) &&
        !(e.target instanceof HTMLElement && e.target.isContentEditable) &&
        document.documentElement.dataset.style === "journal" &&
        window.matchMedia("(min-width: 700px)").matches
      ) {
        e.preventDefault();
        openSearch("");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!shown) return;
    let active = true;
    setHasText(!!input.current?.value);
    setMore(null);
    void loadSuggestions().then(value => { if (active) setMore(value); }).catch(() => {});
    return () => {
      active = false;
    };
  }, [shown]);

  // Leaving for the results (or anywhere) closes the search.
  useEffect(() => {
    if (navigation.state === "loading" && open) close();
  }, [navigation.state]);
  useEffect(() => {
    if (openedAt !== key && open) close();
  }, [key]);

  function close() {
    input.current?.blur();
    setOpen(false);
  }

  const companies = (more?.topics ?? []).filter((t) => t.group === "company").slice(0, 6);
  const quickJumps = QUICK_JUMPS.filter((item) => inNav(item.to));
  const chip = "inline-flex h-11 max-w-full items-center rounded-full px-4 text-[0.875rem] transition-colors lg:h-9 lg:px-3.5 lg:text-[0.8125rem]";
  return (
    <div
      ref={panel}
      role="dialog"
      aria-modal="true"
      aria-label="搜索"
      tabIndex={-1}
      inert={!shown}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      className={`fixed inset-0 z-[75] flex flex-col bg-bg pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] transition-opacity duration-200 ease-[var(--ease-out-quart)] lg:items-center lg:justify-start lg:bg-black/45 lg:px-6 lg:pt-[11vh] ${shown ? "opacity-100 lg:backdrop-blur-[6px]" : "pointer-events-none opacity-0"}`}
    >
      <div
        className={`flex min-h-0 flex-1 flex-col transition-transform duration-200 ease-[var(--ease-out-quart)] lg:max-h-[76vh] lg:w-full lg:max-w-[640px] lg:flex-initial lg:overflow-hidden lg:rounded-2xl lg:border lg:border-line lg:bg-surface lg:shadow-[var(--shadow-overlay)] ${shown ? "translate-y-0 lg:scale-100" : "-translate-y-1 lg:-translate-y-2 lg:scale-[0.98]"}`}
      >
        <Form
          method="get"
          action="/all"
          role="search"
          onSubmit={(e) => {
            const q = input.current?.value.trim() ?? "";
            if (!q) {
              e.preventDefault();
              return;
            }
            addRecentSearch(q);
          }}
          className="flex h-14 shrink-0 items-center gap-1 pl-4 pr-1 pt-[env(safe-area-inset-top)] lg:h-16 lg:gap-2.5 lg:border-b lg:border-line-soft lg:px-4 lg:pt-0"
        >
          <label className="relative flex-1">
            <span className="sr-only">搜索标题和摘要</span>
            <IconSearch size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-4 lg:left-2.5" />
            <input
              ref={input}
              name="q"
              type="search"
              onInput={(e) => setHasText(!!e.currentTarget.value)}
              tabIndex={shown ? 0 : -1}
              placeholder="搜索标题、摘要…"
              maxLength={200}
              autoComplete="off"
              enterKeyHint="search"
              className="h-10 w-full rounded-full bg-surface pl-10 pr-9 text-[1rem] text-ink outline-none ring-1 ring-inset ring-line-strong transition-shadow placeholder:text-ink-4 focus:ring-accent focus:shadow-[0_0_0_3px_var(--accent-soft)] lg:h-11 lg:rounded-xl lg:bg-transparent lg:pl-10 lg:pr-10 lg:ring-0 lg:focus:shadow-none [&::-webkit-search-cancel-button]:hidden"
            />
            {hasText && (
              <button
                type="button"
                aria-label="清空"
                tabIndex={shown ? 0 : -1}
                onClick={() => {
                  if (input.current) input.current.value = "";
                  setHasText(false);
                  input.current?.focus();
                }}
                className="absolute right-1 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full text-ink-4 transition-colors hover:text-ink lg:size-9"
              >
                <IconClose size={15} />
              </button>
            )}
          </label>
          <button type="button" tabIndex={shown ? 0 : -1} onClick={close} className="h-11 shrink-0 px-3 text-[1rem] text-accent lg:hidden">
            取消
          </button>
          <button
            type="button"
            tabIndex={shown ? 0 : -1}
            onClick={close}
            aria-label="关闭搜索"
            className="hidden h-7 shrink-0 items-center rounded-mark border border-line bg-bg-sunk px-2 text-[0.75rem] font-medium text-ink-4 transition-colors hover:border-line-strong hover:text-ink lg:inline-flex"
          >
            <kbd className="mono">ESC</kbd>
          </button>
        </Form>

        {shown && (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(24px,env(safe-area-inset-bottom))] lg:px-5 lg:pb-5">
              {!hasText && quickJumps.length > 0 && (
                <section className="hidden pt-4 lg:block">
                  <h2 className="text-[0.75rem] font-semibold tracking-[0.06em] text-ink-4">快捷跳转</h2>
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    {quickJumps.map((item) => (
                      <Link
                        key={item.to}
                        to={item.to}
                        onClick={close}
                        className="inline-flex h-8 items-center rounded-full border border-line bg-bg-sunk px-3.5 text-[0.8125rem] font-medium text-ink-2 transition-colors hover:border-line-strong hover:bg-bg-muted hover:text-accent"
                      >
                        {item.label}
                      </Link>
                    ))}
                  </div>
                </section>
              )}

              {recent.length > 0 && (
                <section className="pt-3 lg:pt-5">
                  <div className="flex items-center justify-between">
                    <h2 className="text-[0.875rem] font-semibold text-ink-3 lg:text-[0.75rem] lg:tracking-[0.06em] lg:text-ink-4">最近搜索</h2>
                    <button type="button" onClick={clearRecentSearches} className="-mr-2 h-11 px-2 text-[0.875rem] text-ink-4 transition-colors hover:text-ink lg:h-8 lg:text-[0.8125rem]">
                      清除
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {recent.map((q) => (
                      <Link
                        key={q}
                        to={`/all?q=${encodeURIComponent(q)}`}
                        onClick={() => {
                          addRecentSearch(q);
                          close();
                        }}
                        className={`${chip} bg-surface text-ink-2 ring-1 ring-inset ring-line hover:bg-bg-sunk hover:text-accent active:bg-bg-sunk`}
                      >
                        <span className="truncate">{q}</span>
                      </Link>
                    ))}
                  </div>
                </section>
              )}

              {companies.length > 0 && (
                <section className="pt-6 lg:pt-5">
                  <h2 className="text-[0.875rem] font-semibold text-ink-3 lg:text-[0.75rem] lg:tracking-[0.06em] lg:text-ink-4">按主题找</h2>
                  <div className="mt-3 flex flex-wrap gap-2 lg:mt-2.5">
                    {companies.map((t) => (
                      <Link
                        viewTransition
                        key={t.slug}
                        to={`/topics/${t.slug}`}
                        onClick={close}
                        className={`${chip} bg-well text-ink-2 ring-1 ring-inset ring-line-soft hover:bg-bg-sunk hover:text-accent active:bg-bg-muted`}
                      >
                        <span className="truncate">{t.name}</span>
                      </Link>
                    ))}
                    {inNav("/topics") && (
                      <Link
                        viewTransition
                        to="/topics"
                        onClick={close}
                        className={`${chip} gap-1 font-medium text-accent hover:bg-accent-soft`}
                      >
                        全部 {more!.topics.length} 个主题
                      </Link>
                    )}
                  </div>
                </section>
              )}

              {(more?.hot.length ?? 0) > 0 && (
                <section className="pt-6 lg:pt-5">
                  <h2 className="text-[0.875rem] font-semibold text-ink-3 lg:text-[0.75rem] lg:tracking-[0.06em] lg:text-ink-4">正在热议</h2>
                  <ol className="mt-1 divide-y divide-line-soft">
                    {more!.hot.map((h, i) => (
                      <li key={h.to}>
                        <Link
                          viewTransition
                          to={h.to}
                          onClick={close}
                          className="group grid h-12 grid-cols-[18px_minmax(0,1fr)] items-center gap-x-3 rounded-control transition-colors active:opacity-60 lg:-mx-2 lg:h-10 lg:px-2 lg:hover:bg-bg-sunk"
                        >
                          <span className={`num text-center text-[0.875rem] font-bold ${RANK_COLOR[i] ?? "text-rank-rest"}`}>{h.rank}</span>
                          <span className="truncate text-[0.875rem] text-ink transition-colors group-hover:text-accent">{h.title}</span>
                        </Link>
                      </li>
                    ))}
                  </ol>
                </section>
              )}
            </div>

            <div className="hidden items-center justify-between border-t border-line-soft bg-bg-sunk/60 px-5 py-2.5 text-[0.75rem] text-ink-4 lg:flex">
              <span>输入关键词后按 Enter 搜索全部动态</span>
              <span className="inline-flex items-center gap-1.5">
                <kbd className="mono rounded-mark border border-line bg-surface px-1.5 py-0.5 text-[0.6875rem]">⌘K</kbd>
                <span>切换</span>
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
