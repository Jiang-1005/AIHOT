// Public CDN cache policy for SSR pages and GET /api/site/*.
// Browser Cache-Control stays short; Vercel CDN gets s-maxage=600 + SWR 1 day.
// Tagged so daily sync can drop the entries. Never cache admin, mutations, or
// requests/responses that carry private cookies.

export const PUBLIC_CACHE_TAG = "edu-hot-public";
export const PUBLIC_CDN_CACHE_CONTROL = "public, s-maxage=600, stale-while-revalidate=86400";

/** Cookies that personalize or gate a response — those requests must not enter the public CDN. */
export const PRIVATE_CACHE_COOKIES = ["aihot_admin", "aihot_oauth_state", "edu_hot_gate"] as const;

export function requestHasPrivateCookie(cookieHeader: string | string[] | undefined): boolean {
  const raw = Array.isArray(cookieHeader) ? cookieHeader.join("; ") : (cookieHeader ?? "");
  if (!raw) return false;
  return PRIVATE_CACHE_COOKIES.some((name) => new RegExp(`(?:^|;\\s*)${name}=`).test(raw));
}

export function isPublicCdnCacheable(input: {
  method?: string;
  pathname: string;
  status: number;
  requestCookie?: string | string[];
  hasSetCookie: boolean;
  cacheControl?: string;
}): boolean {
  const method = (input.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") return false;
  if (input.status !== 200) return false;
  if (/^\/admin(?:\/|$)/i.test(input.pathname)) return false;
  if (requestHasPrivateCookie(input.requestCookie)) return false;
  if (input.hasSetCookie) return false;
  const cc = input.cacheControl ?? "";
  if (/(?:^|,)\s*(?:private|no-store)(?:$|,|;|\s)/i.test(cc)) return false;
  if (/(?:^|,)\s*no-cache(?:$|,|;|\s)/i.test(cc)) return false;
  return true;
}

export const PUBLIC_CDN_HEADERS: Record<string, string> = {
  "CDN-Cache-Control": PUBLIC_CDN_CACHE_CONTROL,
  "Vercel-CDN-Cache-Control": PUBLIC_CDN_CACHE_CONTROL,
  "Vercel-Cache-Tag": PUBLIC_CACHE_TAG,
};

export const PUBLIC_CDN_HEADER_NAMES = Object.keys(PUBLIC_CDN_HEADERS);

/** Cache-Control used when the origin only sent `public` (or nothing) and the CDN should still cache. */
export const PUBLIC_PAGE_CACHE_CONTROL = `public, max-age=60, s-maxage=600, stale-while-revalidate=86400`;
