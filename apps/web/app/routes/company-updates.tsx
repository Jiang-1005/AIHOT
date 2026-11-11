import { useState } from "react";
import { Link, useLoaderData, useSearchParams } from "react-router";
import { SITE } from "@aihot/site";
import { Wordmark } from "@aihot/site/brand/Logo.tsx";
import type { Route } from "./+types/company-updates";
import { cachedPage, loadOr404 } from "../lib/api.server";
import { pageReuse } from "../lib/page-reuse";
import { pageMeta } from "../lib/seo";
import type { Screen } from "../components/shell/screens";
import { PhoneBar } from "../components/shell/PhoneBar";
import { LogoMark, logoFor } from "../components/facets/FacetChips";
import { PillTabs } from "../components/ui/Tabs";
import { CatalogDayList, CatalogFeedItem, companyCatalogTags } from "../features/feed/CatalogFeed";

export const handle: Screen = { tab: "featured", name: "国内公司动态" };
export { pageHeaders as headers } from "../lib/api.server";
export const { clientLoader, shouldRevalidate } = pageReuse<typeof loader>((url) => url.pathname);

interface CompanyRef {
  id: string;
  name: string;
}

interface CompanyUpdateItem {
  id: string;
  title: string;
  url: string;
  date: string;
  source: string;
  unverified: boolean;
  summary?: string;
  publishedAt?: string;
  multiCompany?: boolean;
  companies?: CompanyRef[];
}

interface CompanyUpdateSection {
  id: string;
  name: string;
  items: CompanyUpdateItem[];
  empty: boolean;
  previewMax?: number;
  latest?: string | null;
}

interface CompanyUpdatesResponse {
  asOf: string;
  since: string;
  section: string;
  previewMax?: number;
  companies: CompanyUpdateSection[];
  timeline?: CompanyUpdateItem[];
  logos: { index: Record<string, string> };
}

export async function loader({ request }: Route.LoaderArgs) {
  const upstream = new Headers();
  const data = await loadOr404<CompanyUpdatesResponse>("/api/site/company-updates", {
    responseHeaders: upstream,
    signal: request.signal,
  });
  return cachedPage(60, data, upstream);
}

export function meta() {
  return pageMeta({
    title: "国内公司动态",
    path: "/companies",
    description: "按时间或按公司查看作业帮、学而思、新东方、讯飞等国内教育公司近 90 天的报道，不走精选门槛。",
  });
}

const EMPTY_COPY = "近 90 天未查到";
const TIME_PREVIEW = 20;

function sortCompaniesByLatest(companies: CompanyUpdateSection[]): CompanyUpdateSection[] {
  return companies.slice().sort((a, b) => {
    const da = a.latest ?? a.items[0]?.date ?? "";
    const db = b.latest ?? b.items[0]?.date ?? "";
    if (db !== da) return db.localeCompare(da);
    return a.name.localeCompare(b.name, "zh");
  });
}

function flattenTimeline(companies: CompanyUpdateSection[], ready?: CompanyUpdateItem[]): CompanyUpdateItem[] {
  if (ready?.length) {
    return ready.slice().sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  }
  const map = new Map<string, CompanyUpdateItem>();
  for (const company of companies) {
    for (const item of company.items) {
      if (!map.has(item.id)) map.set(item.id, item);
    }
  }
  return [...map.values()].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
}

function resolveCompany(companies: CompanyUpdateSection[], raw: string | null): CompanyUpdateSection | undefined {
  const q = (raw ?? "").trim();
  if (!q) return undefined;
  const compact = q.replace(/\s/g, "").toLowerCase();
  return companies.find((c) => {
    if (c.id === q || c.name === q) return true;
    if (c.name.replace(/\s/g, "").toLowerCase() === compact) return true;
    const parts = c.name.split(/[/／]/).map((p) => p.trim().toLowerCase()).filter(Boolean);
    return parts.includes(q.toLowerCase());
  }) ?? companies.find((c) => c.name.includes(q) || q.includes(c.name));
}

function companyHref(name?: string) {
  const params = new URLSearchParams();
  params.set("view", "company");
  if (name) params.set("company", name);
  return `/companies?${params.toString()}`;
}

function CompanyCard({ item }: { item: CompanyUpdateItem }) {
  return (
    <CatalogFeedItem
      title={item.title}
      url={item.url}
      source={item.source}
      at={item.publishedAt ?? item.date}
      summary={item.summary}
      unverified={item.unverified}
      tags={companyCatalogTags(item)}
      mobileLeadTag
    />
  );
}

function CompanyDayList({ items, today }: { items: CompanyUpdateItem[]; today: string }) {
  return (
    <CatalogDayList
      items={items}
      today={today}
      dayOf={(item) => item.date}
      atOf={(item) => item.publishedAt || item.date}
      keyOf={(item) => item.id}
      render={(item) => <CompanyCard item={item} />}
    />
  );
}

function CompanySection({ company, logoIndex, previewMax, expandAll, today }: { company: CompanyUpdateSection; logoIndex: Record<string, string>; previewMax: number; expandAll?: boolean; today: string }) {
  const [open, setOpen] = useState(false);
  const logo = logoFor(company.name, logoIndex) || logoFor(company.name.replace("/", " / "), logoIndex);
  const cap = expandAll ? company.items.length : previewMax;
  const hidden = Math.max(0, company.items.length - cap);
  const shown = open || expandAll ? company.items : company.items.slice(0, cap);
  return (
    <section className="min-w-0">
      <div className="mb-2 flex items-center gap-2">
        <LogoMark name={company.name} src={logo} />
        <h2 className="text-[17px] font-semibold text-ink">{company.name}</h2>
        {!company.empty ? <span className="text-[12px] text-ink-4">{company.items.length} 条</span> : null}
      </div>
      {company.empty ? (
        <p className="text-[14px] leading-7 text-ink-3">{EMPTY_COPY}</p>
      ) : (
        <>
          <CompanyDayList items={shown} today={today} />
          {hidden > 0 ? (
            <button type="button" className="mt-2 text-[13px] text-accent hover:underline" onClick={() => setOpen((v) => !v)}>
              {open ? "收起" : `展开全部（还有 ${hidden} 条）`}
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}

function CompanyChips({ companies, active, allCount }: { companies: CompanyUpdateSection[]; active: string | null; allCount: number }) {
  const ordered = sortCompaniesByLatest(companies);
  const chips: { key: string; name?: string; label: string; count?: number }[] = [
    { key: "__all__", label: "全部", count: allCount || undefined },
    ...ordered.map((c) => ({ key: c.id, name: c.name, label: c.name, count: c.items.length || undefined })),
  ];
  return (
    <div className="scrollbar-none -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <nav aria-label="选择公司" className="flex w-max gap-2 pb-1">
        {chips.map((chip) => {
          const on = chip.key === "__all__" ? !active : active === chip.key || active === chip.name;
          return (
            <Link
              key={chip.key}
              to={companyHref(chip.name)}
              preventScrollReset
              aria-current={on ? "page" : undefined}
              className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] font-medium ring-1 transition-colors ${
                on
                  ? "bg-surface text-ink ring-line shadow-[var(--shadow-thumb)] dark:bg-raised"
                  : "bg-well text-ink-3 ring-line-soft hover:text-ink"
              }`}
            >
              {chip.label}
              {chip.count ? <span className={`num text-[0.86em] font-normal ${on ? "text-ink-3" : "text-ink-4"}`}>{chip.count}</span> : null}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

export default function CompanyUpdatesPage() {
  const data = useLoaderData<typeof loader>();
  const [params] = useSearchParams();
  const companyQuery = params.get("company");
  const viewParam = params.get("view");
  // 只带 ?company=新东方 时进入按公司；显式 ?view=time 仍为按时间。
  const view = viewParam === "company" || (viewParam !== "time" && Boolean(companyQuery)) ? "company" : "time";
  const logoIndex = data.logos?.index ?? {};
  const withNews = data.companies.filter((c) => !c.empty).length;
  const selected = view === "company" ? resolveCompany(data.companies, companyQuery) : undefined;
  const timeline = flattenTimeline(data.companies, data.timeline);
  const [timeOpen, setTimeOpen] = useState(false);
  const timeHidden = Math.max(0, timeline.length - TIME_PREVIEW);
  const timeShown = timeOpen ? timeline : timeline.slice(0, TIME_PREVIEW);
  const companySections = selected ? [selected] : sortCompaniesByLatest(data.companies);

  return (
    <div className="pb-8">
      <PhoneBar
        leading={
          <Link to="/" aria-label={`${SITE.name} 首页`} className="flex h-11 items-center pl-2.5 pr-2 text-ink">
            <Wordmark size={17} />
          </Link>
        }
        title="国内公司动态"
      />
      <header className="mb-6">
        <h1 data-page-title="" className="text-[24px] font-semibold leading-[1.3] text-ink">国内公司动态</h1>
        <p className="mt-2 text-[14px] leading-[1.7] text-ink-3">
          列出最近 90 天内已核对原文（或标明「未查到原文」）的报道。可按时间混看各公司，或按公司筛选。不走精选 60 分和 7 天/往期 30 天门槛，也不会把老条目送进首页精选。没有新动态的公司写「{EMPTY_COPY}」，不拿窗口外的旧稿凑数。
        </p>
        <p className="mt-1 text-[12px] text-ink-4">
          {data.asOf} 北京时间 · {withNews} 家有动态
        </p>
      </header>

      <div className="mb-5">
        <PillTabs
          layoutId="companies-view"
          label="查看方式"
          size="sm"
          items={[
            { key: "time", label: "按时间", to: "/companies?view=time", replace: true },
            { key: "company", label: "按公司", to: "/companies?view=company", replace: true },
          ]}
          active={view}
        />
      </div>

      {view === "time" ? (
        timeline.length === 0 ? (
          <p className="text-[14px] leading-7 text-ink-3">{EMPTY_COPY}</p>
        ) : (
          <>
            <CompanyDayList items={timeShown} today={data.asOf} />
            {timeHidden > 0 ? (
              <button type="button" className="mt-3 text-[13px] text-accent hover:underline" onClick={() => setTimeOpen((v) => !v)}>
                {timeOpen ? "收起" : `展开全部（还有 ${timeHidden} 条）`}
              </button>
            ) : null}
          </>
        )
      ) : (
        <div className="space-y-7">
          <CompanyChips companies={data.companies} active={selected?.id ?? null} allCount={timeline.length} />
          {companySections.map((company) => (
            <CompanySection
              key={company.id}
              company={company}
              logoIndex={logoIndex}
              previewMax={company.previewMax ?? data.previewMax ?? 5}
              expandAll={Boolean(selected)}
              today={data.asOf}
            />
          ))}
        </div>
      )}
    </div>
  );
}
