import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { SITE, withSubject } from "@aihot/site";
import { Wordmark } from "@aihot/site/brand/Logo.tsx";
import { IconChevronDown, IconGithub, IconSearch } from "../icons";
import { IntentLink } from "../ui/IntentLink";
import { openSearch } from "../../features/search/SearchOverlay";
import { activeSidebarItem, inNav, sidebar, sidebarIsActive, type NavItem } from "./nav";
import { useChangelogDot } from "./Sidebar";
import { StyleSelect } from "./Appearance";
import { ThemeSwitch } from "./ThemeSwitch";

interface PrimaryLink extends Pick<NavItem, "to" | "label" | "end" | "covers"> {
  ariaLabel?: string;
}

const PRIMARY_LINKS: PrimaryLink[] = [
  { to: "/", label: "精选", end: true },
  { to: "/hot", label: "热点榜" },
  { to: "/voices", label: "社区热帖" },
  { to: "/companies", label: "公司动态" },
  { to: "/policies", label: "国内政策" },
  { to: "/daily", label: "日报", ariaLabel: withSubject("日报"), covers: ["/weekly", "/monthly"] },
];

const PRIMARY_PATHS = new Set(PRIMARY_LINKS.map((item) => item.to));

function PopoverLink({ item, dot, active, onSelect }: { item: NavItem; dot: boolean; active: boolean; onSelect: () => void }) {
  const Icon = item.icon;
  return (
    <IntentLink
      to={item.to}
      role="menuitem"
      aria-current={active ? "page" : undefined}
      onClick={onSelect}
      className={`relative flex items-center gap-2 rounded-control px-2.5 py-2 text-[0.8125rem] transition-colors duration-150 ${
        active
          ? "bg-accent-soft font-semibold text-accent-ink"
          : "font-medium text-ink-2 hover:bg-bg-sunk hover:text-ink"
      }`}
    >
      <span className={`shrink-0 ${active ? "text-accent" : "text-ink-4"}`}>
        <Icon size={15} />
      </span>
      <span className="min-w-0 truncate">{item.label}</span>
      {dot && item.changelog && <span className="ml-auto size-1.5 shrink-0 rounded-full bg-hot" aria-label="有新的更新" />}
    </IntentLink>
  );
}

/** Floating frosted-glass desktop header, revealed on the journal look at >= 700px via CSS. */
export function TopDeck({ changelogVersion }: { changelogVersion: string | null }) {
  const { pathname } = useLocation();
  const dot = useChangelogDot(changelogVersion);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const moreBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!moreOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setMoreOpen(false);
        moreBtnRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [moreOpen]);

  const primaryLinks = PRIMARY_LINKS.filter((item) => inNav(item.to));
  const archiveItems: NavItem[] = [];
  const communityItems: NavItem[] = [];
  for (const section of sidebar()) {
    const bucket = section.title === "更多" ? communityItems : archiveItems;
    for (const item of section.items) {
      if (!PRIMARY_PATHS.has(item.to)) bucket.push(item);
    }
  }
  const litArchive = activeSidebarItem(archiveItems, pathname);
  const litCommunity = activeSidebarItem(communityItems, pathname);
  const moreActive = Boolean(litArchive || litCommunity);

  return (
    <header data-shell-top="" className="sticky top-0 z-40 hidden h-16 w-full">
      <div className="mx-auto flex h-full max-w-[1280px] items-center gap-3 px-5 wide:px-7">
        <Link to="/" aria-label={`${SITE.name} 首页`} className="group flex shrink-0 items-center gap-2.5 text-ink">
          <Wordmark size={20} className="shrink-0 whitespace-nowrap" />
          <span aria-hidden="true" className="hidden h-4 w-px bg-line xl:inline-block" />
          <span className="hidden text-[0.75rem] font-medium tracking-[0.08em] text-ink-4 xl:inline">情报刊物</span>
        </Link>

        <div className="flex min-w-0 flex-1 items-center gap-1">
          <nav data-top-nav="" aria-label="主导航" className="scrollbar-none flex min-w-0 items-center gap-1 overflow-x-auto py-1">
            {primaryLinks.map((item) => {
              const active = sidebarIsActive(item, pathname);
              return (
                <IntentLink
                  key={item.to}
                  to={item.to}
                  aria-label={item.ariaLabel}
                  aria-current={active ? "page" : undefined}
                  data-top-link=""
                  data-top-link-active={active ? "" : undefined}
                  className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-[0.875rem] transition-all duration-200 ${
                    active
                      ? "bg-accent-soft font-semibold text-accent-ink"
                      : "font-medium text-ink-3 hover:bg-bg-muted hover:text-ink"
                  }`}
                >
                  {item.label}
                </IntentLink>
              );
            })}
          </nav>

          <div ref={moreRef} className="relative shrink-0">
            <button
              ref={moreBtnRef}
              type="button"
              aria-expanded={moreOpen}
              aria-haspopup="menu"
              aria-controls={moreOpen ? "top-deck-more-menu" : undefined}
              onClick={() => setMoreOpen((v) => !v)}
              className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-3 py-1.5 text-[0.875rem] transition-all duration-200 ${
                moreOpen || moreActive
                  ? "bg-accent-soft font-semibold text-accent-ink"
                  : "font-medium text-ink-3 hover:bg-bg-muted hover:text-ink"
              }`}
            >
              <span>更多</span>
              {dot && <span className="size-1.5 shrink-0 rounded-full bg-hot" aria-label="有新的更新" />}
              <IconChevronDown size={14} className={`shrink-0 transition-transform duration-200 ${moreOpen ? "rotate-180" : ""}`} />
            </button>

            {moreOpen && (
              <div
                id="top-deck-more-menu"
                role="menu"
                aria-label="更多页面与外观"
                data-top-popover=""
                className="anim-drop-in absolute right-0 top-[calc(100%+10px)] z-50 w-[296px] rounded-2xl border border-line bg-surface p-3 shadow-[var(--shadow-overlay)]"
              >
                {archiveItems.length > 0 && (
                  <div>
                    <div className="px-2.5 pb-1.5 text-[0.75rem] font-medium tracking-[0.06em] text-ink-4">归档与专题</div>
                    <div className="grid grid-cols-2 gap-1">
                      {archiveItems.map((item) => (
                        <PopoverLink
                          key={item.to}
                          item={item}
                          dot={dot}
                          active={item.to === litArchive?.to}
                          onSelect={() => setMoreOpen(false)}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {(communityItems.length > 0 || SITE.github) && (
                  <div className={archiveItems.length > 0 ? "mt-2.5 border-t border-line-soft pt-2.5" : ""}>
                    <div className="px-2.5 pb-1.5 text-[0.75rem] font-medium tracking-[0.06em] text-ink-4">关于与社区</div>
                    <div className="grid grid-cols-2 gap-1">
                      {communityItems.map((item) => (
                        <PopoverLink
                          key={item.to}
                          item={item}
                          dot={dot}
                          active={item.to === litCommunity?.to}
                          onSelect={() => setMoreOpen(false)}
                        />
                      ))}
                    </div>
                    {SITE.github && (
                      <a
                        href={SITE.github}
                        target="_blank"
                        rel="noopener noreferrer"
                        role="menuitem"
                        onClick={() => setMoreOpen(false)}
                        className="mt-1 flex items-center gap-2 rounded-control px-2.5 py-2 text-[0.8125rem] font-medium text-ink-2 transition-colors duration-150 hover:bg-bg-sunk hover:text-ink"
                      >
                        <IconGithub size={15} className="shrink-0 text-ink-4" />
                        <span>GitHub 开源</span>
                      </a>
                    )}
                  </div>
                )}

                <div className="mt-2.5 border-t border-line-soft pt-2.5">
                  <StyleSelect compact />
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2.5">
          <button
            type="button"
            data-top-search=""
            onClick={(e) => openSearch("", e.currentTarget)}
            aria-label="搜索（快捷键 ⌘K）"
            className="inline-flex h-9 items-center gap-2 rounded-full border border-line bg-surface/85 px-3 text-[0.8125rem] text-ink-3 transition-all hover:border-line-strong hover:bg-surface hover:text-ink"
          >
            <IconSearch size={15} className="shrink-0 text-ink-4" />
            <span className="hidden whitespace-nowrap wide:inline">搜索情报、公司…</span>
            <kbd className="mono hidden h-5 items-center rounded-mark border border-line bg-bg-sunk px-1.5 text-[0.6875rem] font-medium text-ink-4 wide:inline-flex">
              ⌘K
            </kbd>
          </button>
          <ThemeSwitch className="w-[96px] shrink-0" />
        </div>
      </div>
    </header>
  );
}
