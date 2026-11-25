// Phones: a page opened one level deeper (an article, an event, a model, a sub-page of 我的) slides in from
// the right over the page it came from, and the bar's back button slides it away again. Such links opt in
// with React Router's `viewTransition`; the router then wraps the page change in a view transition, and
// this marks on <html data-vt> which way it goes for app.css. The browser's own back (a swipe, a button)
// keeps the browser's animation, and the desktop changes pages at once.
import { useLayoutEffect } from "react";
import { useLocation, useNavigationType } from "react-router";
import { isPhone } from "./screens";

let goingBack = false;

/** Windows WebKit can crash while capturing a history destination with a long list, even on a cache miss. */
export function skipWindowsWebKitHistorySnapshots() {
  const windowsWebKit = navigator.platform.startsWith("Win") && navigator.vendor === "Apple Computer, Inc.";
  if (!windowsWebKit || typeof document.startViewTransition !== "function") return;

  let traversalKey: string | undefined;
  window.addEventListener("popstate", (event) => {
    traversalKey = event.state?.key ?? "default";
  });

  // React Router starts native transitions for matching paths after popstate, even on browser back.
  // Skip before WebKit runs the update callback. The router still commits the destination and restores scroll.
  const start = document.startViewTransition.bind(document);
  document.startViewTransition = (options) => {
    const transition = start(options);
    if (traversalKey === (history.state?.key ?? "default")) {
      // Skipping rejects ready even when the page update succeeds.
      void transition.ready.catch(() => {});
      transition.skipTransition();
    }
    traversalKey = undefined;
    return transition;
  };
}

/** Called just before navigating back from the app's own controls (the bar's back button, a tab tapped deeper in). */
export function markBack() {
  goingBack = true;
}

/** In the root: marks the direction of each page change while it is committed, before the transition animates. */
export function usePageTransition() {
  const { key } = useLocation();
  const type = useNavigationType();
  useLayoutEffect(() => {
    document.documentElement.dataset.vt = !isPhone() ? "none" : goingBack ? "back" : type === "POP" ? "none" : "push";
    goingBack = false;
  }, [key]);
}
