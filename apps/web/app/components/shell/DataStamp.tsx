// 「数据截至 11 月 17 日 20:31 北京时间」at the top of every page: when the site's data was last synced
// (site-sync, /api/site/meta). 社区 carries its own stamp from its catalog, so it is left out there.
// On phones the row also holds 外观 (the desktop top bar has its own).
import { useLocation, useRouteLoaderData } from "react-router";
import type { loader as rootLoader } from "../../root";
import { AppearanceMenu } from "./Appearance";

export function DataStamp() {
  const root = useRouteLoaderData<typeof rootLoader>("root");
  const { pathname } = useLocation();
  const asOf = root && "dataAsOf" in root ? root.dataAsOf : null;
  const stamp = asOf && !(pathname === "/voices" || pathname.startsWith("/voices/"));
  return (
    <div data-stamp-row="" className="flex min-h-11 items-center justify-end gap-2 lg:min-h-0">
      {stamp && (
        <p data-stamp="" className="min-w-0 flex-1 text-[0.8125rem] leading-[1.5] text-ink-3 lg:-mt-2 lg:pb-2 lg:text-right">
          数据截至 <b className="num font-medium text-ink-2">{asOf}</b>
        </p>
      )}
      <div className="lg:hidden"><AppearanceMenu /></div>
    </div>
  );
}
