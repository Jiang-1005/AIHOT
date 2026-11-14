import type { Route } from "./+types/item-original";
import type { SiteItemDetail } from "@aihot/contracts/site";
import { cachedPage, loadOr404 } from "../lib/api.server";
import { loadFollowups } from "../features/item/followups.server";
import { pageReuse } from "../lib/page-reuse";
export { default, handle, headers, meta } from "./item";

// Two expressions, not one shared binding, so the router can ship the client loader as its own tiny chunk.
export const clientLoader = pageReuse<typeof loader>().clientLoader;
export const shouldRevalidate = pageReuse<typeof loader>().shouldRevalidate;
export async function loader({ params, request }: Route.LoaderArgs) {
  const item = await loadOr404<SiteItemDetail>(`/api/site/items/${encodeURIComponent(params.id)}/original`, { signal: request.signal });
  return cachedPage(600, { item, followups: await loadFollowups(item, request.signal) });
}
