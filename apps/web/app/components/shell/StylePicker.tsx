// The look switch (风格): a small fixed button in the top-right corner that opens the list of looks.
// The list comes from lib/site-styles (SITE_STYLES), so a new look shows up here without touching this file.
// Phones: the button sits at the page's top-right, in the top bar's right end (kept free there), and scrolls
// away with the page, so it never sits on text further down; desktop: fixed in the main column's right gutter
// (app/styles/themes/picker.css). Esc or a click outside closes it.
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { SITE_STYLES, setSiteStyle, useSiteStyle } from "../../lib/site-styles";

export function StylePicker() {
  const active = useSiteStyle();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !button.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    // Focus the look in use, so arrows and Enter work at once.
    panel.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const onArrow = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const items = [...(panel.current?.querySelectorAll<HTMLButtonElement>("[role=radio]") ?? [])];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1
      : (at + (e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };

  const label = SITE_STYLES.find((s) => s.id === active)?.label ?? "";
  return (
    <div className="style-picker" data-open={open ? "" : undefined}>
      <button
        ref={button}
        type="button"
        className="style-picker-button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={`切换风格，当前：${label}`}
        title={`风格：${label}`}
        onClick={() => setOpen((v) => !v)}
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6">
          <rect x="2.5" y="2.5" width="6" height="6" rx="1.5" />
          <rect x="11.5" y="2.5" width="6" height="6" rx="3" />
          <rect x="2.5" y="11.5" width="15" height="6" rx="1.5" />
        </svg>
      </button>
      {open && (
        <div ref={panel} id={panelId} className="style-picker-panel" role="radiogroup" aria-label="风格" onKeyDown={onArrow}>
          <p className="style-picker-title">风格</p>
          {SITE_STYLES.map((s) => (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={active === s.id}
              tabIndex={active === s.id ? 0 : -1}
              className="style-picker-option"
              data-style-option={s.id}
              onClick={() => {
                setSiteStyle(s.id);
                setOpen(false);
                button.current?.focus();
              }}
            >
              <span className="style-picker-swatch" data-swatch={s.id} aria-hidden="true" />
              <span className="min-w-0">
                <b>{s.label}</b>
                <span>{s.hint}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
