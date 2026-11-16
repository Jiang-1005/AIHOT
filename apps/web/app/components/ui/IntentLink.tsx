import { useEffect, useRef, useState } from "react";
import { Link, PrefetchPageLinks, useHref, useLocation, type LinkProps } from "react-router";
import { hasFreshPage } from '../../lib/page-reuse';

/**
 * Prefetches when the reader means to open the link: a mouse resting on it for a moment (desktop: the
 * pointer passes over many cards, so only a pause of HOVER_INTENT_MS counts), a mouse or pen button going
 * down, or a touch held still for a moment; scrolling over a card does not. Uses the framework's own
 * prefetch (PrefetchPageLinks) for the page's code.
 */
const HOVER_INTENT_MS = 90;

export function IntentLink({ onPointerDown, onPointerEnter, onPointerLeave, onTouchStart, onTouchMove, onTouchEnd, onTouchCancel, ...props }: Omit<LinkProps, "prefetch">) {
  const location = useLocation();
  // A press belongs to the page it was made on: it serves the navigation it starts, and a link that
  // stays on screen (a tab) does not keep prefetching once the reader is somewhere else.
  const [pressedOn, setPressedOn] = useState<string | null>(null);
  const ready = pressedOn === location.key;
  const href = useHref(props.to);
  // Router prefetch loads chunks but opts clientLoader routes out of data prefetch. Their data is not
  // prefetched here either: behind the CDN the response carries an Age past any short browser max-age, so
  // the browser cannot reuse it, and an in-flight prefetch holds the HTTP cache lock on the very URL the
  // click then fetches, adding a whole round trip to the tap.
  const target = new URL(href, 'http://page.local');
  const differentPage = target.pathname + target.search !== location.pathname + location.search;
  // Router prefetch also asks shouldRevalidate. A selected/remembered page needs neither its
  // assets nor that revalidation decision, which is reserved for an actual refresh. The prefetch is
  // mounted here rather than through Link's prop: Link keeps prefetching after the prop is switched
  // off, and would ask that question again about the page its own click has just opened.
  const shouldPrefetch = ready && differentPage && !hasFreshPage(target);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  const cancel = () => { clear(); setPressedOn(null); };
  useEffect(() => { cancel(); return clear; }, [props.to]);
  return <><Link {...props} prefetch="none"
    onPointerEnter={(e) => {
      onPointerEnter?.(e);
      if (e.pointerType !== "mouse") return;
      clear();
      const on = location.key;
      timer.current = setTimeout(() => { timer.current = null; setPressedOn(on); }, HOVER_INTENT_MS);
    }}
    onPointerLeave={(e) => { onPointerLeave?.(e); clear(); }}
    onPointerDown={(e) => {
      onPointerDown?.(e);
      if (!e.defaultPrevented && e.pointerType !== "touch" && e.button === 0) setPressedOn(location.key);
    }}
    onTouchStart={(e) => {
      onTouchStart?.(e);
      if (e.defaultPrevented) return;
      clear();
      const on = location.key;
      timer.current = setTimeout(() => { timer.current = null; setPressedOn(on); }, 100);
    }}
    onTouchMove={(e) => { onTouchMove?.(e); cancel(); }}
    onTouchEnd={(e) => { onTouchEnd?.(e); cancel(); }}
    onTouchCancel={(e) => { onTouchCancel?.(e); cancel(); }}
  />{shouldPrefetch && <PrefetchPageLinks page={href} />}</>;
}
