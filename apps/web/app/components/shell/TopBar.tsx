// The desktop shell's top bar (lg and up): the brand, the sections, 更多 for the rest of the navigation, and
// 外观. Below wide the sections take a second row. Phones keep their own bars (PhoneBar, TabBar).
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";
import { SITE } from "@aihot/site";
import { IntentLink } from "../ui/IntentLink";
import { Menu } from "../ui/Menu";
import { IconChevronDown, IconGithub } from "../icons";
import { useChangelogSeen } from "../../lib/local-state";
import { activeSidebarItem, sidebar, type NavItem } from "./nav";
import { Appearance } from "./Appearance";
import { Filings } from "./Filings";

/** True while the changelog has an entry newer than the one this reader last opened. */
export function useChangelogDot(latestVersion: string | null): boolean {
  const seen = useChangelogSeen();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || !latestVersion) return false;
  return !seen || seen < latestVersion;
}

/** The sections in the bar, by route, with the bar's short names; every other entry goes under 更多. */
const SHORT: Record<string, string> = {
  "/": "首页",
  "/all": "全部",
  "/voices": "社区",
  "/hot": "热点榜",
  "/companies": "公司",
  "/policies": "政策",
  "/daily": "日报",
  "/archive": "往期",
};
const ORDER = Object.keys(SHORT);

export function TopBar({ changelogVersion }: { changelogVersion: string | null }) {
  const dot = useChangelogDot(changelogVersion);
  const { pathname } = useLocation();
  const items = sidebar().flatMap((s) => s.items);
  const main = ORDER.flatMap((to) => items.filter((i) => i.to === to));
  const more = items.filter((i) => !(i.to in SHORT));
  const lit = activeSidebarItem(items, pathname);
  const moreLit = more.some((i) => i.to === lit?.to);
  return (
    <header data-top-bar="" className="sticky top-0 z-40 hidden border-b border-line bg-bg lg:block">
      <div className="mx-auto flex max-w-[var(--page-max-wide)] flex-wrap items-center gap-x-6 gap-y-1 px-5 py-2 wide:flex-nowrap wide:px-7">
        <Link to="/" data-brand="" className="shrink-0 whitespace-nowrap font-serif text-[1.25rem] font-bold leading-[2.5rem] text-ink" aria-label={`${SITE.name} 首页`}>
          {SITE.name}
        </Link>
        <div className="order-last -mx-2 w-full min-w-0 wide:order-none wide:mx-0 wide:w-auto wide:flex-1">
          <nav aria-label="主导航" className="flex items-center gap-1 overflow-x-auto">
            {main.map((item) => <TopLink key={item.to} item={item} label={SHORT[item.to]!} active={item.to === lit?.to} />)}
            {more.length > 0 && (
              <Menu label="更多" triggerClassName="h-9 px-[6px]" trigger={<span data-more-trigger="" className={`flex items-center gap-1 whitespace-nowrap px-1 text-[0.9375rem] ${moreLit ? "font-semibold text-ink" : ""}`}>更多<IconChevronDown size={14} />{dot && <span className="size-1.5 rounded-full bg-hot" aria-label="有新的更新" />}</span>}>
                {(close) => (
                  <>
                    {more.map((item) => (
                      <IntentLink key={item.to} role="menuitem" to={item.to} onClick={close} aria-current={item.to === lit?.to ? "page" : undefined}
                        className="flex h-10 items-center gap-2 px-4 text-[0.875rem] text-ink-2 outline-none hover:bg-bg-sunk hover:text-ink focus-visible:bg-bg-sunk">
                        <span className="flex-1 whitespace-nowrap">{item.label}</span>
                        {dot && item.changelog && <span className="size-1.5 rounded-full bg-hot" aria-label="有新的更新" />}
                      </IntentLink>
                    ))}
                    {SITE.github && (
                      <a role="menuitem" href={SITE.github} target="_blank" rel="noopener noreferrer" onClick={close}
                        className="flex h-10 items-center gap-2 border-t border-line-soft px-4 text-[0.875rem] text-ink-2 outline-none hover:bg-bg-sunk hover:text-ink focus-visible:bg-bg-sunk">
                        <IconGithub size={14} /> GitHub 开源
                      </a>
                    )}
                  </>
                )}
              </Menu>
            )}
          </nav>
        </div>
        <div className="ml-auto"><Appearance /></div>
      </div>
    </header>
  );
}

function TopLink({ item, label, active }: { item: NavItem; label: string; active: boolean }) {
  return (
    <IntentLink
      to={item.to}
      data-nav-link=""
      aria-current={active ? "page" : undefined}
      className={`shrink-0 whitespace-nowrap rounded-control px-[10px] py-[6px] text-[0.9375rem] transition-colors duration-150 ${active ? "font-semibold text-ink" : "text-ink-3 hover:bg-bg-sunk hover:text-ink"}`}
    >
      {label}
    </IntentLink>
  );
}

/** The desktop pages' foot: the source link, who runs the site and the filing numbers (they sat under the sidebar). */
export function SiteFooter() {
  return (
    <footer data-site-footer="" className="mx-auto mt-10 hidden max-w-[var(--page-max-wide)] flex-wrap items-center justify-center gap-x-5 gap-y-2 border-t border-line px-5 py-6 text-[0.8125rem] text-ink-3 lg:flex wide:px-7">
      {SITE.github && <a href={SITE.github} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-ink"><IconGithub size={13} /> GitHub 开源</a>}
      {SITE.poweredBy && <a href={SITE.poweredBy.url} target="_blank" rel="noopener" className="hover:text-ink">由 {SITE.poweredBy.name} 驱动</a>}
      <Filings className="whitespace-nowrap text-[0.8125rem] leading-[1.3] text-ink-3 hover:text-ink" badgeSize={11} />
    </footer>
  );
}
