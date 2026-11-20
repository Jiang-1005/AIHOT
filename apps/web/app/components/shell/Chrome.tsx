import { useEffect, useRef, useState } from "react";
import { IconArrowUp } from "../icons";
import { scrollBehavior } from "../../lib/motion";

/** A thin accent line while a navigation is in flight: it starts at once (a click gets an answer within
 *  a frame), so even a slow page shows that the click was heard. */
export function NavigationProgress({ active }: { active: boolean }) {
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (active) timer.current = setTimeout(() => setVisible(true), 0);
    else {
      if (timer.current) clearTimeout(timer.current);
      setVisible(false);
    }
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [active]);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-[2px] overflow-hidden" aria-hidden="true">
      <div
        className="h-full origin-left bg-accent"
        style={{
          transform: `scaleX(${visible ? 0.85 : active ? 0.12 : 1})`,
          opacity: visible || active ? 1 : 0,
          transition: visible ? "transform 300ms cubic-bezier(0.25, 1, 0.5, 1), opacity 150ms cubic-bezier(0.25, 1, 0.5, 1)" : "transform 200ms cubic-bezier(0.4, 0, 1, 1), opacity 150ms cubic-bezier(0.4, 0, 1, 1)",
        }}
      />
    </div>
  );
}

/** Round "back to top" button once the reader has scrolled a screen or so (desktop; on phones the tab bar does it). */
export function BackToTop() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const onScroll = () => setShown(window.scrollY > window.innerHeight * 1.2);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <button
      type="button"
      aria-label="回到顶部"
      onClick={() => window.scrollTo({ top: 0, behavior: scrollBehavior() })}
      className={`fixed bottom-[max(20px,env(safe-area-inset-bottom))] right-[max(20px,env(safe-area-inset-right))] z-30 hidden size-10 items-center justify-center rounded-full border border-line-strong bg-surface/95 text-ink-3 shadow-[var(--shadow-soft)] backdrop-blur-sm transition-[transform,opacity,color] duration-200 hover:text-ink lg:flex ${
        shown ? "translate-y-0 opacity-100 ease-[var(--ease-enter)]" : "pointer-events-none translate-y-2 opacity-0 ease-[var(--ease-exit)]"
      }`}
    >
      <IconArrowUp size={16} />
    </button>
  );
}
