// 外观: the look (风格) and light/dark (深浅) as two plain selects, in the desktop top bar and on 我的.
import { useEffect, useState } from "react";
import { Select } from "../ui/Controls";
import { Menu } from "../ui/Menu";
import { applyTheme, resolvedTheme, setThemePreference, useThemePreference, type ThemePreference } from "../../lib/local-state";
import { SITE_STYLES, isSiteStyle, setSiteStyle, useSiteStyle } from "../../lib/site-styles";

const MODES = [
  { key: "system", label: "跟随系统" },
  { key: "light", label: "浅色" },
  { key: "dark", label: "深色" },
] as const;

function chooseMode(value: string) {
  const pref: ThemePreference = value === "light" || value === "dark" ? value : null;
  setThemePreference(pref);
  applyTheme(resolvedTheme(pref), pref === null);
}

export function StyleSelect({ className = "" }: { className?: string }) {
  const style = useSiteStyle();
  return (
    <Select aria-label="风格" className={className} value={style} onChange={(e) => isSiteStyle(e.target.value) && setSiteStyle(e.target.value)}>
      {SITE_STYLES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
    </Select>
  );
}

export function ModeSelect({ className = "" }: { className?: string }) {
  const pref = useThemePreference();
  // The server renders 跟随系统; the stored choice shows once hydrated (the page colours are already right).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <Select aria-label="深浅" className={className} value={mounted ? (pref ?? "system") : "system"} onChange={(e) => chooseMode(e.target.value)}>
      {MODES.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
    </Select>
  );
}

/** The top bar's group: 外观 [风格] [深浅]. */
export function Appearance() {
  return (
    <div role="group" aria-label="外观" data-appearance="" className="flex shrink-0 items-center gap-2">
      <span className="text-[0.8125rem] text-ink-3" aria-hidden="true">外观</span>
      <StyleSelect />
      <ModeSelect />
    </div>
  );
}

/** Phones: 外观 as a small menu (风格, then 深浅) beside the data stamp at the top of the page. */
export function AppearanceMenu() {
  const style = useSiteStyle();
  const pref = useThemePreference();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const mode = mounted ? (pref ?? "system") : "system";
  const row = "flex h-11 w-full items-center gap-2 px-4 text-left text-[0.9375rem] text-ink-2 outline-none hover:bg-bg-sunk focus-visible:bg-bg-sunk";
  const check = (on: boolean) => <span aria-hidden="true" className={`w-4 text-accent ${on ? "" : "invisible"}`}>✓</span>;
  return (
    <Menu label="外观" triggerClassName="h-11 px-2 text-[0.875rem] text-ink-2" trigger={<span data-appearance-trigger="">外观</span>}>
      {(close) => (
        <>
          <div className="px-4 pb-1 pt-2 text-[0.8125rem] text-ink-3">风格</div>
          {SITE_STYLES.map((s) => (
            <button key={s.id} type="button" role="menuitemradio" aria-checked={style === s.id} className={row} onClick={() => { setSiteStyle(s.id); close(); }}>
              {check(style === s.id)}{s.label}
            </button>
          ))}
          <div className="border-t border-line-soft px-4 pb-1 pt-2 text-[0.8125rem] text-ink-3">深浅</div>
          {MODES.map((m) => (
            <button key={m.key} type="button" role="menuitemradio" aria-checked={mode === m.key} className={row} onClick={() => { chooseMode(m.key); close(); }}>
              {check(mode === m.key)}{m.label}
            </button>
          ))}
        </>
      )}
    </Menu>
  );
}
