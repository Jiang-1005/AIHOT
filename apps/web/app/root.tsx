import {
  isRouteErrorResponse, Link, Links, Meta, Outlet, Scripts, ScrollRestoration, useLoaderData, useLocation, useNavigation, useRouteError, useRouteLoaderData,
  type ShouldRevalidateFunction,
} from "react-router";
import type { SiteMeta } from "@aihot/contracts/site";
import { SITE } from "@aihot/site";
import { RingMark } from "@aihot/site/brand/Logo.tsx";
import { useEffect, useState, type ReactNode } from "react";
import type { Route } from "./+types/root";
import "./app.css";
import { STYLE_BOOT_SCRIPT } from "./lib/site-styles";
import { PALETTE_BOOT_SCRIPT } from "./lib/journal-palette";
import { Sidebar } from "./components/shell/Sidebar";
import { TopDeck } from "./components/shell/TopDeck";
import { Filings } from "./components/shell/Filings";
import { TabBar } from "./components/shell/TabBar";
import { PullToRefresh } from "./components/shell/PullToRefresh";
import { usePageTransition } from "./components/shell/transitions";
import { useWarmSectionCode } from "./components/shell/warm-nav";
import { SearchOverlay } from "./features/search/SearchOverlay";
import { BackToTop, NavigationProgress } from "./components/shell/Chrome";
import { IconGithub, IconRss } from "./components/icons";
import { buttonClass } from "./components/ui/Controls";
import { rememberPage, APPEARANCE_BOOT_SCRIPT, useAppearanceSync } from "./lib/local-state";
import { apiGet, previewApiBase } from "./lib/api.server";
import { useHydratedFlag } from "./lib/hydration";
import { titled } from "./lib/seo";
import { webModules } from "./site-modules";

export const headers: Route.HeadersFunction = () => ({ "X-Robots-Tag": "noindex, nofollow" });

export const links: Route.LinksFunction = () => [
  { rel: "icon", href: "/favicon.ico", sizes: "any" },
  { rel: "apple-touch-icon", href: "/apple-icon.png" },
  { rel: "manifest", href: "/manifest.webmanifest" },
  { rel: "alternate", type: "application/rss+xml", title: `${SITE.name} — 精选`, href: "/feed.xml" },
];

/** The release rendering this document: once a newer one is deployed, a render error reloads the page (entry.client). */
export async function loader({ request }: Route.LoaderArgs) {
  const release = process.env.AIHOT_RELEASE ?? null;
  try {
    const meta = await apiGet<SiteMeta>("/api/site/meta", {
      headers: Object.assign({}, ...webModules().map((m) => m.root?.documentHeaders?.(request) ?? {})),
      signal: request.signal,
      base: previewApiBase(),
    });
    return { ...meta, release };
  } catch {
    return { changelogVersion: null, release };
  }
}

export const shouldRevalidate: ShouldRevalidateFunction = () => false;

export function Layout({ children }: { children: React.ReactNode }) {
  const site = useRouteLoaderData<typeof loader>("root");
  const [documentRelease] = useState(site?.release ?? null);
  return (
    <html lang={SITE.locale} suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        {documentRelease && <meta name="release" content={documentRelease} />}
        {documentRelease && <meta name="aihot-release" content={documentRelease} />}
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="color-scheme" content="light dark" />
        <meta name="theme-color" media="(prefers-color-scheme: light)" content="#faf6f0" />
        <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#110f0e" />
        <meta name="apple-mobile-web-app-title" content={SITE.name} />
        <meta name="robots" content="noindex, nofollow" />
        <script dangerouslySetInnerHTML={{ __html: APPEARANCE_BOOT_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: STYLE_BOOT_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: PALETTE_BOOT_SCRIPT }} />
        {webModules().map((m) => m.root?.bootScript && <script key={m.name} dangerouslySetInnerHTML={{ __html: m.root.bootScript }} />)}
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration getKey={(location) => location.key} />
        <Scripts />
      </body>
    </html>
  );
}

/** Only a page nobody matched falls back to this; every page names itself. */
export function meta({ error }: Route.MetaArgs) {
  if (!error) return [];
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  return [{ title: titled(notFound ? "页面不存在" : "暂时无法加载") }, { name: "robots", content: "noindex" }];
}

/** Sidebar, main column and phone tab bar around a page (or an error). */
function SiteShell({ changelogVersion, children }: { changelogVersion: string | null; children: ReactNode }) {
  const navigation = useNavigation();
  // The phone search and pull-to-refresh are client-side, mounted once the page is interactive.
  const [interactive, setInteractive] = useState(false);
  useEffect(() => setInteractive(true), []);
  return (
    // The desktop shell also opens on large phones held sideways, where the notch takes a side: the whole
    // shell keeps clear of it (the phone shell does so through its gutters).
    <div data-site-shell="" className="flex min-h-dvh lg:pl-[env(safe-area-inset-left)] lg:pr-[env(safe-area-inset-right)]">
      <NavigationProgress active={navigation.state === "loading"} />
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[70] focus:rounded-control focus:bg-surface focus:px-3 focus:py-2">
        跳到正文
      </a>
      <TopDeck changelogVersion={changelogVersion} />
      <Sidebar changelogVersion={changelogVersion} />
      {/* Phone shell (≤ 699px): each page's top bar (PhoneBar), one centred column, the tab bar below.
          Desktop: the page fills the main area up to the list width (--page-max-wide), centred beyond it. */}
      <main id="main" data-shell-main="" className="min-w-0 flex-1 pb-[calc(72px+env(safe-area-inset-bottom))] lg:px-5 lg:pb-[72px] lg:pt-6 wide:px-7">
        <div data-shell-container="" className="mx-auto w-full max-w-[640px] pl-[var(--gutter-l)] pr-[var(--gutter-r)] lg:max-w-[var(--page-max-wide)] lg:px-0">
          {webModules().map((m) => m.root?.Top && <m.root.Top key={m.name} />)}
          {children}
          <footer data-journal-footer="" className="mt-14 hidden border-t border-line pt-6 pb-4 text-[0.75rem] text-ink-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <span className="inline-flex items-center gap-2 text-ink-3">
                  <strong className="font-serif text-[0.875rem] font-semibold text-ink">{SITE.name}</strong>
                  {SITE.tagline && <span className="text-ink-4">· {SITE.tagline}</span>}
                </span>
                <span aria-hidden="true" className="hidden h-3 w-px bg-line lg:inline-block" />
                <nav aria-label="页脚链接" className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5">
                  <Link to="/about" className="transition-colors hover:text-ink">关于</Link>
                  <Link to="/changelog" className="transition-colors hover:text-ink">更新日志</Link>
                  <Link to="/feedback" className="transition-colors hover:text-ink">反馈</Link>
                  <Link to="/agent" className="transition-colors hover:text-ink">Agent 接入</Link>
                  <Link reloadDocument to="/feed.xml" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 transition-colors hover:text-ink">
                    <IconRss size={12} />
                    RSS
                  </Link>
                </nav>
              </div>
              <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5">
                {SITE.github && (
                  <a href={SITE.github} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 transition-colors hover:text-ink">
                    <IconGithub size={13} />
                    GitHub 开源
                  </a>
                )}
                {SITE.poweredBy && (
                  <a href={SITE.poweredBy.url} target="_blank" rel="noopener noreferrer" className="whitespace-nowrap transition-colors hover:text-ink">
                    由 {SITE.poweredBy.name} 驱动
                  </a>
                )}
                <Filings className="whitespace-nowrap transition-colors hover:text-ink" badgeSize={10} />
                {SITE.footerNote && <span className="text-ink-4">{SITE.footerNote}</span>}
              </div>
            </div>
          </footer>
        </div>
      </main>
      <TabBar changelogVersion={changelogVersion} />
      {interactive && <SearchOverlay />}
      {interactive && <PullToRefresh />}
      <BackToTop />
    </div>
  );
}

export default function App() {
  const meta = useLoaderData<typeof loader>();
  useHydratedFlag();
  useAppearanceSync();
  const { pathname, search } = useLocation();
  useEffect(() => rememberPage(pathname + search), [pathname, search]);
  usePageTransition();
  useWarmSectionCode();
  // iOS Safari only shows :active (pressed) styles once the document listens for touches.
  useEffect(() => {
    const noop = () => {};
    document.addEventListener("touchstart", noop, { passive: true });
    return () => document.removeEventListener("touchstart", noop);
  }, []);
  // The admin has its own chrome.
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return <Outlet />;
  return (
    <>
      <SiteShell changelogVersion={meta.changelogVersion}>
        <Outlet />
      </SiteShell>
      {webModules().map((m) => m.root?.Bottom && <m.root.Bottom key={m.name} />)}
    </>
  );
}

export function ErrorBoundary() {
  useAppearanceSync();
  const error = useRouteError();
  const site = useRouteLoaderData<typeof loader>("root");
  const { pathname, search, hash } = useLocation();
  const status = isRouteErrorResponse(error) ? error.status : 500;
  const notFound = status === 404;
  const body = (
    <div className="flex min-h-[70vh] items-center justify-center px-2 py-16">
      <div className="max-w-sm text-center">
        <RingMark className="mx-auto mb-5 size-10 text-accent" />
        <div className="mono text-[0.75rem] text-ink-4">{status}</div>
        <h1 className="mt-2 text-[1.25rem] font-semibold leading-[1.3] text-ink">{notFound ? "找不到这个页面" : "暂时无法加载"}</h1>
        <p className="mt-2 text-[0.875rem] leading-relaxed text-ink-3">
          {notFound ? "链接可能有误，或者这条内容已经下架。" : "页面暂时无法显示，请重新加载后再试。"}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          {!notFound && <Link reloadDocument to={pathname + search + hash} className={buttonClass("primary")}>
            重新加载
          </Link>}
          <Link reloadDocument to="/" className={buttonClass(notFound ? "primary" : "secondary")}>
            回到精选
          </Link>
          <Link reloadDocument to="/all" className={buttonClass("secondary")}>
            浏览全部动态
          </Link>
        </div>
      </div>
    </div>
  );
  // Admin errors stay inside the admin's own chrome.
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return body;
  return <SiteShell changelogVersion={site?.changelogVersion ?? null}>{body}</SiteShell>;
}
