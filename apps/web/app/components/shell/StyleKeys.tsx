// 控制台's keyboard: j / k move between the rows of a list (精选, 全部, 热帖…) and focus the row's link, so
// Enter opens it (/ already jumps to search site-wide, Filters.tsx). Only while the console look is on,
// and never while the reader is typing.
import { useEffect } from "react";
import { useSiteStyle } from "../../lib/site-styles";

const ROWS = "[data-feed-slot], .voices-grid > .voice-card, [data-voices-view='compact'] > .voice-row";

function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

export function StyleKeys() {
  const look = useSiteStyle();
  useEffect(() => {
    if (look !== "console") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      if (document.querySelector("dialog[open], [role='dialog']:not([inert]), [aria-modal='true']:not([inert])")) return;
      if (e.key !== "j" && e.key !== "k") return;
      const rows = [...document.querySelectorAll<HTMLElement>(ROWS)].filter((r) => r.offsetParent !== null);
      if (!rows.length) return;
      e.preventDefault();
      const at = rows.findIndex((r) => r.hasAttribute("data-kb-current"));
      const next = at < 0 ? 0 : Math.max(0, Math.min(rows.length - 1, at + (e.key === "j" ? 1 : -1)));
      rows[at]?.removeAttribute("data-kb-current");
      const row = rows[next]!;
      row.setAttribute("data-kb-current", "");
      const link = row.querySelector<HTMLElement>("a[href], button");
      link?.focus({ preventScroll: true });
      row.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.querySelectorAll("[data-kb-current]").forEach((r) => r.removeAttribute("data-kb-current"));
    };
  }, [look]);
  return null;
}
