// Public pages already rendered in this document can be revisited until their server deadline.
// Nothing persists across a document reload; list snapshots separately own the reader's position.
import { useCallback, useEffect, useRef } from 'react';
import { useFetcher, type ClientLoaderFunctionArgs, type ShouldRevalidateFunction } from 'react-router';

const pages = new Map<string, unknown>();
// Results still on their way, so a click that follows a warm-up waits for that request instead of sending its own.
const pending = new Map<string, Promise<unknown>>();
const MAX_PAGES = 16;
const addressOf = (url: URL) => url.pathname + url.search;
const deadlineOf = (value: unknown) => (value as { expiresAt?: number } | null)?.expiresAt ?? 0;

export function hasFreshPage(url: URL): boolean {
  return deadlineOf(pages.get(addressOf(url))) > Date.now();
}

/**
 * A page's client loader and the router hook that goes with it, made together so they agree on `key`.
 * `key` names the result an address reads, as the address that holds it. Addresses with one key share
 * that result (the tabs of a page that reads the same data) and only the first read asks the server.
 * By default every address has its own.
 */
export function pageReuse<T>(key: (url: URL) => string = addressOf) {
  async function clientLoader({ request, serverLoader }: ClientLoaderFunctionArgs) {
    const held = key(new URL(request.url));
    const previous = pages.get(held);
    pages.delete(held);
    if (deadlineOf(previous) > Date.now()) {
      pages.set(held, previous);
      return previous as Awaited<ReturnType<typeof serverLoader<T>>>;
    }
    const inFlight = pending.get(held);
    if (inFlight) {
      const warmed = await inFlight.catch(() => null);
      if (deadlineOf(warmed) > Date.now()) return warmed as Awaited<ReturnType<typeof serverLoader<T>>>;
    }
    // On hydration this is the HTML's own result, without another HTTP request.
    const asked = serverLoader<T>();
    pending.set(held, asked);
    let result: Awaited<ReturnType<typeof serverLoader<T>>>;
    try {
      result = (await asked) as Awaited<ReturnType<typeof serverLoader<T>>>;
    } finally {
      if (pending.get(held) === asked) pending.delete(held);
    }
    if (!request.signal.aborted && deadlineOf(result) > Date.now()) {
      pages.set(held, result);
      if (pages.size > MAX_PAGES) pages.delete(pages.keys().next().value!);
    }
    return result;
  }
  clientLoader.hydrate = true as const;

  const shouldRevalidate: ShouldRevalidateFunction = ({ currentUrl, nextUrl, defaultShouldRevalidate }) => {
    // Revalidator/retry, or tapping the current page again: ask for its data normally.
    if (defaultShouldRevalidate && addressOf(currentUrl) === addressOf(nextUrl)) pages.delete(key(nextUrl));
    // Moving between addresses that share a result still runs the loader, which keeps the result while it is fresh.
    return defaultShouldRevalidate || key(currentUrl) === key(nextUrl);
  };

  return { clientLoader, shouldRevalidate };
}

/**
 * Warms the result an address will need when the pointer rests on what opens it (a filter chip), so the
 * click that follows reads it from `pages` instead of waiting on the server. One request at a time: a newer
 * intent replaces the one in flight. Only for pages built with `pageReuse`.
 */
export function useWarmPage(delayMs = 40): (href: string) => void {
  const fetcher = useFetcher();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const last = useRef<string | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return useCallback((href: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      const url = new URL(href, window.location.origin);
      if (hasFreshPage(url) || last.current === href) return;
      last.current = href;
      fetcher.load(href);
    }, delayMs);
  }, [fetcher, delayMs]);
}
