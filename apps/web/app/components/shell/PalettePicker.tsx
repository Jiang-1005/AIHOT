import { useEffect, useState } from "react";
import { DEFAULT_PALETTE, JOURNAL_PALETTES, setJournalPalette, useJournalPalette } from "../../lib/journal-palette";

/** Four-palette live switcher for the journal flagship look (TopDeck popover & mobile /more). */
export function PalettePicker({ compact = false }: { compact?: boolean }) {
  const palette = useJournalPalette();
  // Server renders the default; stored preference appears after hydration without mismatch.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const current = mounted ? palette : DEFAULT_PALETTE;

  return (
    <div role="radiogroup" aria-label="刊物色板" className="grid grid-cols-4 gap-1.5">
      {JOURNAL_PALETTES.map((p) => {
        const active = current === p.id;
        return (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={active}
            title={p.fullLabel}
            data-palette-option={p.id}
            onClick={() => setJournalPalette(p.id)}
            className={`flex flex-col items-center justify-center gap-1.5 rounded-tile border px-1 py-2 text-[0.75rem] leading-none transition-all duration-150 ${
              compact ? "min-h-[52px]" : ""
            } ${
              active
                ? "border-accent bg-accent-soft font-semibold text-accent-ink ring-1 ring-accent/25"
                : "border-line bg-bg-sunk/70 font-medium text-ink-3 hover:border-line-strong hover:text-ink"
            }`}
          >
            <span
              aria-hidden="true"
              className="size-3.5 shrink-0 rounded-full ring-1 ring-inset ring-black/15 dark:hidden"
              style={{
                backgroundColor: p.swatch,
                boxShadow: `0 0 0 1.5px color-mix(in srgb, ${p.ring} 26%, transparent)`,
              }}
            />
            <span
              aria-hidden="true"
              className="hidden size-3.5 shrink-0 rounded-full ring-1 ring-inset ring-white/25 dark:inline-block"
              style={{
                backgroundColor: p.swatchDark,
                boxShadow: `0 0 0 1.5px color-mix(in srgb, ${p.swatchDark} 32%, transparent)`,
              }}
            />
            <span className="whitespace-nowrap">{p.label}</span>
          </button>
        );
      })}
    </div>
  );
}
