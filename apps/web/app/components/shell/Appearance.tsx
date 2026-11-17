// 外观 · 风格: the look picker that sits with the light/dark switch (sidebar bottom, 我的 → 外观).
// 原版 is the default and the production design; the other looks apply only once chosen.
import { useEffect, useState } from "react";
import { SITE_STYLES, isSiteStyle, setSiteStyle, shortLabel, useSiteStyle, DEFAULT_STYLE } from "../../lib/site-styles";
import { IconChevronDown } from "../icons";

export function StyleSelect({ className = "", compact = false }: { className?: string; compact?: boolean }) {
  const style = useSiteStyle();
  // The server renders 原版; the stored choice shows once hydrated (the page is already styled by then).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const value = mounted ? style : DEFAULT_STYLE;
  return (
    <label className={`relative flex items-center ${className}`}>
      <span className="sr-only">外观风格</span>
      <select
        aria-label="外观风格"
        data-style-select=""
        value={value}
        onChange={(e) => isSiteStyle(e.target.value) && setSiteStyle(e.target.value)}
        className={`w-full cursor-pointer appearance-none rounded-full border border-line bg-bg-sunk pl-3 pr-8 text-ink-2 outline-none transition-colors hover:text-ink focus-visible:border-accent ${compact ? "h-[34px] text-[0.8125rem] touch:h-11" : "h-11 text-[1rem] lg:h-8 lg:text-[0.875rem]"}`}
      >
        {SITE_STYLES.map((s) => <option key={s.id} value={s.id}>{compact ? `外观：${shortLabel(s)}` : s.label}</option>)}
      </select>
      <IconChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-4" />
    </label>
  );
}
