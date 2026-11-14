import { useEffect } from "react";
import { matchRoutes, useLocation, type RouteObject } from "react-router";

type RouterWindow = Window & {
  __reactRouterDataRouter?: { routes: RouteObject[] };
  __reactRouterManifest?: { routes: Record<string, { clientLoaderModule?: string }> };
  __reactRouterRouteModules?: Record<string, unknown>;
};

const MAX_PAGES = 16;

/**
 * A page with a clientLoader can only start reading its data once that loader's code has arrived, so a cold
 * tap on a section costs two round trips. Route modules are split (react-router.config.ts), and each
 * section's client loader is a chunk of a few dozen bytes: once the page is idle, load those (not the pages'
 * components, not their data) for the top-level sections a link on screen leads to. A tap then fetches the
 * data and the page's code side by side.
 */
export function useWarmSectionCode() {
  const { pathname } = useLocation();
  useEffect(() => {
    const w = window as RouterWindow;
    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      const router = w.__reactRouterDataRouter;
      const manifest = w.__reactRouterManifest;
      if (!router || !manifest) return;
      const paths = new Set<string>();
      let article = false;
      for (const a of document.querySelectorAll<HTMLAnchorElement>('a[href^="/"]')) {
        if (paths.size >= MAX_PAGES) break;
        const url = new URL(a.href);
        if (url.origin !== location.origin || !a.getClientRects().length) continue;
        // Sections, plus one article: every article shares the same route and loader chunk.
        const deep = /^\/[^/]+\/./.test(url.pathname);
        if (deep && (article || !url.pathname.startsWith("/items/"))) continue;
        if (deep) article = true;
        paths.add(url.pathname);
      }
      const modules = new Set<string>();
      for (const path of paths) {
        for (const m of matchRoutes(router.routes, path) ?? []) {
          const id = m.route.id;
          const href = id ? manifest.routes[id]?.clientLoaderModule : undefined;
          if (href) modules.add(href);
        }
      }
      for (const href of modules) void import(/* @vite-ignore */ href).catch(() => {});
    };
    const start = () => {
      if ("requestIdleCallback" in window) window.requestIdleCallback(run, { timeout: 1500 });
      else setTimeout(run, 300);
    };
    if (document.readyState === "complete") start();
    else window.addEventListener("load", start, { once: true });
    return () => {
      cancelled = true;
      window.removeEventListener("load", start);
    };
  }, [pathname]);
}
