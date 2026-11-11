import { useState } from "react";
import { Link, useLoaderData } from "react-router";
import { SITE } from "@aihot/site";
import { Wordmark } from "@aihot/site/brand/Logo.tsx";
import type { Route } from "./+types/policy-updates";
import { cachedPage, loadOr404 } from "../lib/api.server";
import { pageReuse } from "../lib/page-reuse";
import { pageMeta } from "../lib/seo";
import type { Screen } from "../components/shell/screens";
import { PhoneBar } from "../components/shell/PhoneBar";
import { CatalogDayList, CatalogFeedItem } from "../features/feed/CatalogFeed";

export const handle: Screen = { tab: "featured", name: "国内政策" };
export { pageHeaders as headers } from "../lib/api.server";
export const { clientLoader, shouldRevalidate } = pageReuse<typeof loader>();

interface PolicyUpdateItem {
  id: string;
  title: string;
  url: string;
  date: string;
  source: string;
  unverified: boolean;
  consultationDraft?: boolean;
  summary?: string;
  publishedAt?: string;
}

interface PolicyUpdatesResponse {
  asOf: string;
  since: string;
  section: string;
  items: PolicyUpdateItem[];
}

export async function loader({ request }: Route.LoaderArgs) {
  const upstream = new Headers();
  const data = await loadOr404<PolicyUpdatesResponse>("/api/site/policy-updates", {
    responseHeaders: upstream,
    signal: request.signal,
  });
  return cachedPage(60, data, upstream);
}

export function meta() {
  return pageMeta({
    title: "国内政策",
    path: "/policies",
    description: "近 90 天国内教育政策补录，按日期倒序；征求意见稿会标明未施行。",
  });
}

const PREVIEW = 20;

function PolicyCard({ item }: { item: PolicyUpdateItem }) {
  return (
    <CatalogFeedItem
      title={item.title}
      url={item.url}
      source={item.source}
      at={item.publishedAt ?? item.date}
      summary={item.summary}
      unverified={item.unverified}
      consultationDraft={item.consultationDraft}
    />
  );
}

export default function PolicyUpdatesPage() {
  const data = useLoaderData<typeof loader>();
  const [open, setOpen] = useState(false);
  const hidden = Math.max(0, data.items.length - PREVIEW);
  const shown = open ? data.items : data.items.slice(0, PREVIEW);

  return (
    <div className="pb-8">
      <PhoneBar
        leading={
          <Link to="/" aria-label={`${SITE.name} 首页`} className="flex h-11 items-center pl-2.5 pr-2 text-ink">
            <Wordmark size={17} />
          </Link>
        }
        title="国内政策"
      />
      <header className="mb-6">
        <h1 data-page-title="" className="text-[24px] font-semibold leading-[1.3] text-ink">国内政策</h1>
        <p className="mt-2 text-[14px] leading-[1.7] text-ink-3">
          以近 90 天政策补录为准，已核对原文（或标明「未查到原文」），按文章自己的日期倒序。征求意见稿会标明「征求意见稿，未施行」。不走精选 7 天和往期 30 天新鲜度规则，也不会把老条目送进首页精选。
        </p>
        <p className="mt-1 text-[12px] text-ink-4">
          {data.asOf} 北京时间 · 共 {data.items.length} 条
        </p>
      </header>

      {data.items.length === 0 ? (
        <p className="text-[14px] leading-7 text-ink-3">近三个月未查到</p>
      ) : (
        <>
          <CatalogDayList
            items={shown}
            today={data.asOf}
            dayOf={(item) => item.date}
            atOf={(item) => item.publishedAt || item.date}
            keyOf={(item) => item.id}
            render={(item) => <PolicyCard item={item} />}
          />
          {hidden > 0 ? (
            <button type="button" className="mt-3 text-[13px] text-accent hover:underline" onClick={() => setOpen((v) => !v)}>
              {open ? "收起" : `展开全部（还有 ${hidden} 条）`}
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}
