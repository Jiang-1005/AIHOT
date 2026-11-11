// Node writeHead hook for Vercel SSR: public GET pages get CDN TTL + tag;
// admin, mutations, Set-Cookie, and private cookies stay private, no-store.
import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from "node:http";
import {
  isPublicCdnCacheable,
  PUBLIC_CDN_HEADER_NAMES,
  PUBLIC_CDN_HEADERS,
  PUBLIC_PAGE_CACHE_CONTROL,
  requestHasPrivateCookie,
} from "./public-cache.ts";

function needsDefaultPublicTtl(cacheControl: string): boolean {
  if (!cacheControl) return true;
  if (/^public\s*$/i.test(cacheControl)) return true;
  return !/(?:^|,)\s*s-maxage=/i.test(cacheControl) && /^public\b/i.test(cacheControl);
}

function isAdminPath(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

function isSafeRead(method: string | undefined): boolean {
  const m = (method ?? "GET").toUpperCase();
  return m === "GET" || m === "HEAD";
}

export function attachPublicCdnCache(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  cookieHeader?: string,
): void {
  const writeHead = res.writeHead.bind(res);
  res.writeHead = ((
    status: number,
    messageOrHeaders?: string | OutgoingHttpHeaders,
    headers?: OutgoingHttpHeaders,
  ) => {
    const outgoing = typeof messageOrHeaders === "string" ? headers : messageOrHeaders;
    for (const [name, value] of Object.entries(outgoing ?? {})) {
      if (value !== undefined) res.setHeader(name, value);
    }
    const cc = String(res.getHeader("Cache-Control") ?? "");
    const cookie = cookieHeader ?? (Array.isArray(req.headers.cookie) ? req.headers.cookie.join("; ") : req.headers.cookie);
    const cacheable = isPublicCdnCacheable({
      method: req.method,
      pathname,
      status,
      requestCookie: cookie,
      hasSetCookie: res.hasHeader("Set-Cookie"),
      cacheControl: cc,
    });
    if (cacheable) {
      if (needsDefaultPublicTtl(cc)) res.setHeader("Cache-Control", PUBLIC_PAGE_CACHE_CONTROL);
      for (const [k, v] of Object.entries(PUBLIC_CDN_HEADERS)) res.setHeader(k, v);
    } else if (requestHasPrivateCookie(cookie) || isAdminPath(pathname) || !isSafeRead(req.method)) {
      res.setHeader("Cache-Control", "private, no-store");
      for (const name of PUBLIC_CDN_HEADER_NAMES) res.removeHeader(name);
    } else {
      for (const name of PUBLIC_CDN_HEADER_NAMES) res.removeHeader(name);
    }
    return typeof messageOrHeaders === "string" ? writeHead(status, messageOrHeaders) : writeHead(status);
  }) as typeof res.writeHead;
}
