// 刊物 · 旗舰版 color palettes (data-palette on <html>).
// Mirrors site-styles.ts: edge-cached HTML boots via PALETTE_BOOT_SCRIPT before first paint,
// and readers can switch live across the 4 curated palettes with View Transitions.
import { useSyncExternalStore } from "react";
import { reducedMotion } from "./motion";

export const JOURNAL_PALETTES = [
  { id: "vermilion", label: "赤陶", fullLabel: "赤陶朱砂", swatch: "#c84b31", ring: "#1b1817", swatchDark: "#f07153" },
  { id: "cobalt", label: "克莱因", fullLabel: "克莱因蓝", swatch: "#1d4ed8", ring: "#0f1e46", swatchDark: "#60a5fa" },
  { id: "obsidian", label: "黑金", fullLabel: "黑金炭墨", swatch: "#9f1239", ring: "#141413", swatchDark: "#e5c07b" },
  { id: "jade", label: "翡翠", fullLabel: "翡翠青瓷", swatch: "#0d7a6f", ring: "#103e38", swatchDark: "#54c7b6" },
] as const;

export type JournalPaletteId = (typeof JOURNAL_PALETTES)[number]["id"];

export const DEFAULT_PALETTE: JournalPaletteId = "vermilion";
export const PALETTE_KEY = "aihot-palette";
export const PALETTE_PARAM = "palette";

const IDS: readonly string[] = JOURNAL_PALETTES.map((p) => p.id);
export const isJournalPalette = (v: unknown): v is JournalPaletteId => typeof v === "string" && IDS.includes(v);

/**
 * Runs in <head> before the first paint: ?palette=, then the stored choice, then the default.
 */
export const PALETTE_BOOT_SCRIPT = `(function(){var ids=${JSON.stringify(IDS)},k=${JSON.stringify(PALETTE_KEY)},p=null;function ok(v){return ids.indexOf(v)>-1}try{var v=new URLSearchParams(location.search).get(${JSON.stringify(PALETTE_PARAM)});if(ok(v)){p=v;try{localStorage.setItem(k,p)}catch(e){}}}catch(e){}if(!p){try{var w=localStorage.getItem(k);if(ok(w))p=w}catch(e){}}document.documentElement.setAttribute('data-palette',p||${JSON.stringify(DEFAULT_PALETTE)})})();`;

function current(): JournalPaletteId {
  const v = document.documentElement.getAttribute("data-palette");
  return isJournalPalette(v) ? v : DEFAULT_PALETTE;
}

const listeners = new Set<() => void>();
function apply(id: JournalPaletteId) {
  document.documentElement.setAttribute("data-palette", id);
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  const onStorage = (e: StorageEvent) => {
    if (e.key === PALETTE_KEY && isJournalPalette(e.newValue)) apply(e.newValue);
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", onStorage);
  };
}

/** The active journal palette (the server renders the default; the boot script sets the real one first). */
export function useJournalPalette(): JournalPaletteId {
  return useSyncExternalStore(subscribe, current, () => DEFAULT_PALETTE);
}

/** Switches the journal palette, persists it, strips ?palette= if present, and cross-fades cleanly. */
export function setJournalPalette(id: JournalPaletteId) {
  try {
    localStorage.setItem(PALETTE_KEY, id);
  } catch {
    /* private mode: the page still switches */
  }
  try {
    const url = new URL(location.href);
    if (url.searchParams.has(PALETTE_PARAM)) {
      url.searchParams.delete(PALETTE_PARAM);
      history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }
  } catch {
    /* ignore */
  }
  if (current() === id) {
    apply(id);
    return;
  }
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (doc.startViewTransition && !reducedMotion()) {
    delete doc.documentElement.dataset.vt;
    doc.startViewTransition(() => apply(id));
  } else {
    apply(id);
  }
}
