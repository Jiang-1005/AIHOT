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
// Two expressions, not one shared binding, so the router can ship the client loader as its own tiny chunk.
export const clientLoader = pageReuse<typeof loader>().clientLoader;
export const shouldRevalidate = pageReuse<typeof loader>().shouldRevalidate;

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

type PolicyCategory = "all" | "national" | "local" | "draft";

const NATIONAL_POLICY_PATTERN = /教育部|国务院|中央|中共|中办|国办|全国|国家|发改委|工信部|网信办|科技部|人社部|财政部|广电总局|市场监管总局|多部门|九部门|七部门|五部门/;

function classifyPolicy(item: PolicyUpdateItem): Exclude<PolicyCategory, "all"> {
  if (item.consultationDraft) return "draft";
  if (NATIONAL_POLICY_PATTERN.test(`${item.source} ${item.title}`)) return "national";
  return "local";
}

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
  const [kind, setKind] = useState<PolicyCategory>("all");
  const [open, setOpen] = useState(false);

  const counts = { all: data.items.length, national: 0, local: 0, draft: 0 };
  for (const item of data.items) counts[classifyPolicy(item)]++;

  const filtered = kind === "all" ? data.items : data.items.filter((item) => classifyPolicy(item) === kind);
  const hidden = Math.max(0, filtered.length - PREVIEW);
  const shown = open ? filtered : filtered.slice(0, PREVIEW);

  return (
    <div className="pb-20">
      <PhoneBar
        leading={
          <Link to="/" aria-label={`${SITE.name} 首页`} className="flex h-11 items-center pl-3 pr-2 text-ink">
            <Wordmark size={17} />
          </Link>
        }
        title="国内政策"
      />
      <header className="mb-5">
        <h1 data-page-title="" className="text-[1.75rem] font-semibold leading-[1.3] text-ink">国内政策</h1>
        <p className="mt-2 text-[0.875rem] leading-[1.7] text-ink-3">
          汇集近 90 天国家级与地方教育 AI 相关政策文件，按发布日期倒序；征求意见稿已标明「未施行」。
        </p>
        <p className="mt-1 text-[0.75rem] text-ink-4">
          {data.asOf} 北京时间 · 共 {data.items.length} 条
        </p>
      </header>

      {data.items.length > 0 && (
        <div className="mb-5 flex flex-wrap gap-2" role="group" aria-label="政策层级筛选">
          {(
            [
              ["all", "全部"],
              ["national", "国家级"],
              ["local", "地方试点"],
              ["draft", "征求意见稿"],
            ] as const
          ).map(([key, label]) => {
            const on = kind === key;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={on}
                onClick={() => { setKind(key); setOpen(false); }}
                className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[0.75rem] font-medium transition-all duration-150 ${
                  on
                    ? "bg-accent text-accent-contrast shadow-[var(--shadow-card)]"
                    : "border border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink"
                }`}
              >
                <span>{label}</span>
                <span className={`num font-normal ${on ? "text-accent-contrast/80" : "text-ink-4"}`}>{counts[key]}</span>
              </button>
            );
          })}
        </div>
      )}

      {data.items.length === 0 ? (
        <p className="text-[0.875rem] leading-7 text-ink-3">近三个月未查到</p>
      ) : filtered.length === 0 ? (
        <p className="text-[0.875rem] leading-7 text-ink-3">当前分类暂无政策条目。</p>
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
            <button type="button" className="mt-4 inline-flex h-9 items-center rounded-full border border-line bg-surface px-4 text-[0.8125rem] font-medium text-accent transition-colors hover:border-line-strong hover:text-accent-ink" onClick={() => setOpen((v) => !v)}>
              {open ? "收起" : `展开全部（还有 ${hidden} 条）`}
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}
