// The site's looks (风格). One list drives the boot script, the 外观 menu and the stylesheets: each look is a
// set of CSS variables and component rules under html[data-style="<id>"] in app/styles/looks/<id>.css.
// Light and dark (data-theme, aihot-theme) stay a separate choice inside every look.
//
// Adding a look: one entry here, one file app/styles/looks/<id>.css, one @import line in app.css.
import { useSyncExternalStore } from "react";

/** In the order the 外观 menu lists them; the first is the default. */
export const SITE_STYLES = [
  { id: "paper", label: "暖纸" },
  { id: "press", label: "编辑部" },
  { id: "clean", label: "明净／夜读" },
  { id: "glass", label: "浮层玻璃" },
] as const satisfies ReadonlyArray<{ id: string; label: string }>;

export type SiteStyleId = (typeof SITE_STYLES)[number]["id"];

export const DEFAULT_STYLE: SiteStyleId = "paper";
/** localStorage key. Not aihot-theme: that one holds light/dark. */
export const STYLE_KEY = "aihot-style";
/** ?style=<id> opens a look for a shared link and keeps it. */
export const STYLE_PARAM = "style";

const IDS: readonly string[] = SITE_STYLES.map((s) => s.id);
export const isSiteStyle = (v: unknown): v is SiteStyleId => typeof v === "string" && IDS.includes(v);

/**
 * Runs in <head> before the first paint: ?style=, then the stored choice, then the default. The HTML is
 * cached at the edge for everyone, so the server never renders a reader's look; this script sets it first.
 */
export const STYLE_BOOT_SCRIPT = `(function(){var ids=${JSON.stringify(IDS)},k=${JSON.stringify(STYLE_KEY)},s=null;function ok(v){return ids.indexOf(v)>-1}try{var v=new URLSearchParams(location.search).get(${JSON.stringify(STYLE_PARAM)});if(ok(v)){s=v;try{localStorage.setItem(k,s)}catch(e){}}}catch(e){}if(!s){try{var w=localStorage.getItem(k);if(ok(w))s=w}catch(e){}}document.documentElement.setAttribute('data-style',s||${JSON.stringify(DEFAULT_STYLE)})})();`;

function current(): SiteStyleId {
  const v = document.documentElement.getAttribute("data-style");
  return isSiteStyle(v) ? v : DEFAULT_STYLE;
}

const listeners = new Set<() => void>();
function apply(id: SiteStyleId) {
  document.documentElement.setAttribute("data-style", id);
  for (const fn of listeners) fn();
}
function subscribe(fn: () => void) {
  listeners.add(fn);
  const onStorage = (e: StorageEvent) => {
    if (e.key === STYLE_KEY && isSiteStyle(e.newValue)) apply(e.newValue);
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", onStorage);
  };
}

/** The look on the page now (the server renders the default; the boot script has already set the real one). */
export function useSiteStyle(): SiteStyleId {
  return useSyncExternalStore(subscribe, current, () => DEFAULT_STYLE);
}

/** Switches the look and stores it; drops ?style= from the address so the stored choice rules from now on. */
export function setSiteStyle(id: SiteStyleId) {
  try { localStorage.setItem(STYLE_KEY, id); } catch { /* private mode: the page still switches */ }
  try {
    const url = new URL(location.href);
    if (url.searchParams.has(STYLE_PARAM)) {
      url.searchParams.delete(STYLE_PARAM);
      history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }
  } catch { /* ignore */ }
  apply(id);
}
