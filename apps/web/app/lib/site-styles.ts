// The site's looks (风格): one list drives the boot script, the picker and the stylesheet hook. Each look
// is a set of CSS variables and layout rules under html[data-style="<id>"] in app/styles/themes/<id>.css,
// imported from app.css. Light and dark (data-theme, aihot-theme) stay a separate choice inside every look.
//
// Adding a look: one entry here, one file app/styles/themes/<id>.css, one @import line in app.css.
import { useSyncExternalStore } from "react";

export const SITE_STYLES = [
  { id: "paper", label: "晨报", hint: "报纸分栏，衬线大标题" },
  { id: "console", label: "控制台", hint: "密集列表，适合快速扫读" },
  { id: "bento", label: "看板", hint: "大卡片，头条一块主色" },
  { id: "motion", label: "微动", hint: "会自己动的卡片，深色大圆角" },
] as const satisfies ReadonlyArray<{ id: string; label: string; hint: string }>;

export type SiteStyleId = (typeof SITE_STYLES)[number]["id"];

export const DEFAULT_STYLE: SiteStyleId = "paper";
/** localStorage key and cookie name. Not aihot-theme: that one holds light/dark. */
export const STYLE_KEY = "aihot-style";
/** ?style=<id> wins; ?theme=<id> (the design preview's links) is honoured only for a look id, never light/dark. */
export const STYLE_PARAMS = ["style", "theme"] as const;

const IDS: readonly string[] = SITE_STYLES.map((s) => s.id);
export const isSiteStyle = (v: unknown): v is SiteStyleId => typeof v === "string" && IDS.includes(v);

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * Runs in <head> before the first paint: the address, then the stored choice, then the cookie, then the
 * default. A look named in the address is also stored, so the next page keeps it. The HTML is cached at
 * the edge for everyone, so the server never renders a reader's look itself; this script does, before paint.
 */
export const STYLE_BOOT_SCRIPT = `(function(){var ids=${JSON.stringify(IDS)},k=${JSON.stringify(STYLE_KEY)},s=null,fromUrl=false;function ok(v){return ids.indexOf(v)>-1}try{var q=new URLSearchParams(location.search);${JSON.stringify(STYLE_PARAMS)}.forEach(function(p){var v=q.get(p);if(!s&&ok(v)){s=v;fromUrl=true}})}catch(e){}if(!s){try{var v=localStorage.getItem(k);if(v&&v.charAt(0)==='"')v=JSON.parse(v);if(ok(v))s=v}catch(e){}}if(!s){var m=document.cookie.match(new RegExp('(?:^|; )'+k+'=([^;]*)'));if(m&&ok(m[1]))s=m[1]}if(!s)s=${JSON.stringify(DEFAULT_STYLE)};document.documentElement.setAttribute('data-style',s);if(fromUrl){try{localStorage.setItem(k,s)}catch(e){}document.cookie=k+'='+s+'; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax'}})();`;

function current(): SiteStyleId {
  const v = document.documentElement.getAttribute("data-style");
  return isSiteStyle(v) ? v : DEFAULT_STYLE;
}

const listeners = new Set<() => void>();
function subscribe(fn: () => void) {
  listeners.add(fn);
  const onStorage = (e: StorageEvent) => {
    if (e.key === STYLE_KEY && isSiteStyle(e.newValue)) applyStyle(e.newValue);
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", onStorage);
  };
}

function applyStyle(id: SiteStyleId) {
  document.documentElement.setAttribute("data-style", id);
  for (const fn of listeners) fn();
}

/** The look on the page now (the server renders the default; the boot script has already set the real one). */
export function useSiteStyle(): SiteStyleId {
  return useSyncExternalStore(subscribe, current, () => DEFAULT_STYLE);
}

/** Switches the look, stores it (localStorage and cookie) and drops ?style=/?theme= look ids from the address. */
export function setSiteStyle(id: SiteStyleId, { transition = true }: { transition?: boolean } = {}) {
  try { localStorage.setItem(STYLE_KEY, id); } catch { /* private mode: the page still switches */ }
  document.cookie = `${STYLE_KEY}=${id}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`;
  try {
    const url = new URL(location.href);
    let changed = false;
    for (const p of STYLE_PARAMS) if (isSiteStyle(url.searchParams.get(p))) { url.searchParams.delete(p); changed = true; }
    if (changed) history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
  } catch { /* ignore */ }
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (transition && doc.startViewTransition && !reduce) {
    delete doc.documentElement.dataset.vt;
    doc.startViewTransition(() => applyStyle(id));
  } else applyStyle(id);
}
