// 微动 (motion look) only: cards that move on their own, from data the page already has.
// 精选: 焦点轮播, the five best-scored reports, one every 4 s (blur out, blur in, a progress bar per item).
// 热帖: 快讯, the newest posts stacked like notifications, a new one every 2.8 s.
// A loop runs only while its card is on screen, the tab is visible, nothing in it is hovered or focused,
// and the reader has not asked for reduced motion; otherwise the card stands still on its first item.
import { useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { Link } from "react-router";
import { useSiteStyle } from "../../lib/site-styles";
import { reducedMotion } from "../../lib/motion";

function useLoop(ms: number, count: number, on: boolean) {
  const ref = useRef<HTMLElement>(null);
  const [index, setIndex] = useState(0);
  const [running, setRunning] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!on || !el || count < 2 || reducedMotion()) return;
    let visible = false;
    let held = false;
    const update = () => setRunning(visible && !held && document.visibilityState === "visible");
    const io = new IntersectionObserver(([e]) => { visible = !!e?.isIntersecting; update(); }, { threshold: 0.3 });
    io.observe(el);
    const hold = () => { held = true; update(); };
    const release = () => setTimeout(() => { held = el.matches(":hover") || el.contains(document.activeElement); update(); }, 0);
    el.addEventListener("pointerenter", hold);
    el.addEventListener("pointerleave", release);
    el.addEventListener("focusin", hold);
    el.addEventListener("focusout", release);
    document.addEventListener("visibilitychange", update);
    return () => {
      io.disconnect();
      el.removeEventListener("pointerenter", hold);
      el.removeEventListener("pointerleave", release);
      el.removeEventListener("focusin", hold);
      el.removeEventListener("focusout", release);
      document.removeEventListener("visibilitychange", update);
      setRunning(false);
    };
  }, [count, on]);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % count), ms);
    return () => clearInterval(t);
  }, [running, ms, count]);
  return { ref, index, setIndex, running };
}

function Stage({ title, children, stageRef, running, ms }: { title: string; children: ReactNode; stageRef: Ref<HTMLElement>; running: boolean; ms: number }) {
  return (
    <section ref={stageRef} className="motion-stage" aria-label={title} data-running={running ? "" : undefined} style={{ "--motion-loop": `${ms}ms` } as React.CSSProperties}>
      <p className="motion-stage-title">{title}{running ? "" : <span className="sr-only">（已暂停）</span>}</p>
      {children}
    </section>
  );
}

export interface FocusEntry { id: string; title: string; summary: string | null; source: string; score: number | null }

/** 精选 front page, motion look: the five best-scored reports in turn. */
export function FocusCarousel({ entries }: { entries: FocusEntry[] }) {
  const on = useSiteStyle() === "motion";
  const top = [...entries].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 5);
  const { ref, index, setIndex, running } = useLoop(4000, top.length, on);
  if (!on || !top.length) return null;
  const at = index % top.length;
  const it = top[at]!;
  return (
    <Stage title="焦点轮播" stageRef={ref} running={running} ms={4000}>
      <div className="motion-swap" key={it.id} aria-live="off">
        <p className="motion-meta"><span>{it.source}</span>{it.score != null && <span className="motion-score num">AI 评分 {Math.round(it.score)}</span>}</p>
        <h2 className="motion-focus-title">{it.title}</h2>
        {it.summary && <p className="motion-focus-summary">{it.summary}</p>}
      </div>
      <div className="motion-foot">
        <div className="motion-dots" aria-hidden="true">
          {top.map((e, i) => <i key={`${e.id}-${i === at ? index : "x"}`} className={i === at ? "on" : i < at ? "done" : undefined} />)}
        </div>
        <button type="button" className="motion-link" onClick={() => setIndex(at + 1)}>下一条</button>
        <Link viewTransition to={`/items/${it.id}`} className="motion-link">阅读这条 →</Link>
      </div>
    </Stage>
  );
}

export interface FlashEntry { id: string; title: string; platform: string; when: string }

/** 社区热帖, motion look: the newest posts pushed in one by one. */
export function FlashStack({ entries, onOpen }: { entries: FlashEntry[]; onOpen: (id: string) => void }) {
  const on = useSiteStyle() === "motion";
  const pool = entries.slice(0, 8);
  const { ref, index, running } = useLoop(2800, pool.length, on);
  if (!on || pool.length < 3) return null;
  const shown = [0, 1, 2].map((k) => pool[(index + k) % pool.length]!);
  return (
    <Stage title="热帖快讯" stageRef={ref} running={running} ms={2800}>
      <ol className="motion-stack">
        {shown.map((e, k) => (
          <li key={e.id} data-depth={k}>
            <button type="button" onClick={() => onOpen(e.id)}>
              <span className="motion-meta"><span>{e.platform}</span><span className="num">{e.when}</span></span>
              <span className="motion-stack-title">{e.title}</span>
            </button>
          </li>
        ))}
      </ol>
    </Stage>
  );
}
