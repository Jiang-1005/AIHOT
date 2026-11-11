import type { ReactNode, SelectHTMLAttributes } from "react";
import { IconCheck, IconChevronDown } from "../icons";

type Variant = "primary" | "secondary";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-accent-contrast hover:bg-accent-ink disabled:opacity-45",
  secondary: "border border-line-strong bg-surface text-ink-2 hover:border-ink-4 hover:text-ink disabled:opacity-50",
};

type Size = "md" | "lg";
const SIZES: Record<Size, string> = { md: "h-11 px-4 text-[13.5px] lg:h-9", lg: "h-11 px-5 text-[14.5px]" };

/** The pill button's classes, for links that look like buttons. */
export function buttonClass(variant: Variant = "secondary", size: Size = "md"): string {
  return `inline-flex items-center justify-center gap-1.5 rounded-full font-medium transition-[background-color,border-color,color,transform] duration-150 active:scale-[0.98] ${SIZES[size]} ${VARIANTS[variant]}`;
}

/** Native select as a pill, like the site's other controls. */
export function Select({ className = "", children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className={`relative inline-flex ${className}`}>
      <select
        className="h-11 w-full cursor-pointer appearance-none rounded-full border border-line-strong bg-surface py-0 pl-3.5 pr-8 text-[16px] text-ink-2 outline-none lg:h-8 lg:text-[12.5px] transition-colors hover:border-ink-4 focus:border-accent"
        {...rest}
      >
        {children}
      </select>
      <IconChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-4" />
    </span>
  );
}

/**
 * A filter that combines with others: a pill with its own small check mark, so a row of them reads
 * as "pick any" rather than the one-of-many `PillTabs` switch.
 */
export function ToggleChip({ on, onToggle, children, size = "md" }: { on: boolean; onToggle: () => void; children: ReactNode; size?: "md" | "sm" }) {
  const compact = size === "sm";
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onToggle}
      className={`inline-flex shrink-0 select-none items-center whitespace-nowrap rounded-full border font-medium transition-colors duration-150 active:scale-[0.98] ${
        compact
          ? "h-auto gap-1 py-1 pl-1.5 pr-2.5 text-[12px]"
          : "h-11 gap-1.5 pl-2 pr-3.5 text-[13px] lg:h-8"
      } ${on ? "border-accent/35 bg-accent-soft text-accent" : "border-line-strong bg-surface text-ink-2 hover:border-ink-4 hover:text-ink"}`}
    >
      <span aria-hidden="true" className={`inline-flex items-center justify-center rounded-full border transition-colors duration-150 ${compact ? "size-3.5" : "size-4"} ${on ? "border-accent bg-accent text-accent-contrast" : "border-line-strong"}`}>
        {on && <IconCheck size={compact ? 9 : 11} strokeWidth={3} />}
      </span>
      {children}
    </button>
  );
}
