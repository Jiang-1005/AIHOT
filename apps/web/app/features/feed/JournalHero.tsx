// Flagship "刊物" (journal) desktop above-the-fold Asymmetric Bento Hero:
// 7-col Lead Feature Card (editorial headline, summary, reason callout) paired with a
// 5-col stacked Dual Bento (deep-jade Daily Briefing Card + 48h Hot Pulse / Radar fallback).
// Hidden by default so SSR HTML matches all looks and mobile (<700px); journal.css reveals
// it via `[data-journal-hero]` at `@media (min-width: 700px)` under `:root[data-style="journal"]`.
import { Link } from "react-router";
import { shortAddresses } from "@aihot/contracts/addresses";
import type { TimelineCard } from "@aihot/contracts/site";
import { beijingAt } from "@aihot/contracts/time";
import { ITEM_COPY } from "@aihot/site";
import { IconArrowRight, IconBuilding, IconGrid, IconLandmark, IconMessage } from "../../components/icons";
import { IntentLink } from "../../components/ui/IntentLink";
import { ScoreLabel, shownScore } from "../../components/ui/Score";
import { WordTitle } from "../../components/ui/WordTitle";
import { rowDates } from "../../lib/format";
import { publicCopy } from "../../lib/public-copy";
import { rememberPreview } from "../item/preview";
import type { MastheadIssue } from "./Masthead";
import { GroupSources } from "./ReadingGroup";
import { SourceLine, StarButton } from "./parts";

export interface HeroHotItem {
  rank: number;
  title: string;
  to: string;
  sources: string;
}

const FALLBACK_RADAR = [
  { to: "/voices", label: "社区热帖", desc: "一线家长与教师实测", icon: IconMessage },
  { to: "/companies", label: "公司动态", desc: "头部机构产品进展", icon: IconBuilding },
  { to: "/policies", label: "国内政策", desc: "部委与省市教育发文", icon: IconLandmark },
  { to: "/topics", label: "主题图谱", desc: "按方向与产品脉络看", icon: IconGrid },
] as const;

export function JournalHero({
  lead,
  issue,
  today,
  todayCount,
  hot,
  onOpenLead,
}: {
  lead: TimelineCard;
  issue: MastheadIssue | null;
  today: string;
  todayCount: number;
  hot: HeroHotItem[];
  onOpenLead?: (id: string) => void;
}) {
  const noon = beijingAt(today, "12:00").getTime();
  const dates = rowDates(lead.item.publishedAt, lead.anchorAt, noon);
  const timeText = [dates.day, dates.clock].filter(Boolean).join(" ");
  const headline = lead.item.title || (lead.item.summary ? shortAddresses(lead.item.summary) : lead.item.source.name);
  const summary = lead.item.summary ? shortAddresses(lead.item.summary) : null;
  const reason = publicCopy(lead.item.reason);
  const hasScore = shownScore(lead.item.score) !== null;

  return (
    <section data-journal-hero="" aria-label="今日头版" className="mb-7 hidden grid-cols-1 gap-5 lg:grid-cols-12">
      {/* Left 7 columns — Flagship Lead Feature Card */}
      <article
        data-hero-lead=""
        className="group relative flex flex-col justify-between overflow-hidden rounded-[16px] border border-line bg-surface p-6 lg:col-span-7 wide:p-7"
      >
        <div>
          <header className="flex items-center gap-2.5 text-[0.75rem] text-ink-4">
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-0.5 text-[0.75rem] font-semibold text-accent-ink">
              <span className="size-1.5 rounded-full bg-accent" aria-hidden="true" />
              今日头版
            </span>
            <SourceLine item={lead.item} className="font-medium text-ink-3" />
            {timeText && (
              <time dateTime={lead.item.publishedAt ?? lead.anchorAt} className="mono shrink-0 text-ink-4">
                {timeText}
              </time>
            )}
            <span className="ml-auto flex shrink-0 items-center gap-2">
              {hasScore && (
                <span data-fi-score="">
                  <ScoreLabel score={lead.item.score} />
                </span>
              )}
              <StarButton item={lead.item} className="size-8" />
            </span>
          </header>

          <div className="mt-4 flex-1">
            <h2 className="font-serif text-[1.4375rem] font-bold leading-[1.34] tracking-[-0.015em] text-ink transition-colors duration-200 group-hover:text-accent wide:text-[1.75rem]">
              <IntentLink
                viewTransition
                to={`/items/${lead.item.id}`}
                onClick={() => {
                  rememberPreview(lead.item);
                  onOpenLead?.(lead.item.id);
                }}
                className="after:absolute after:inset-0 after:content-['']"
              >
                <WordTitle>{headline}</WordTitle>
              </IntentLink>
            </h2>

            {summary && (
              <p className="mt-3 line-clamp-3 text-[0.9375rem] leading-[1.75] text-ink-2">
                {summary}
              </p>
            )}

            {reason && (
              <div className="mt-4 rounded-xl border border-accent/15 bg-accent-softer px-4 py-3 text-[0.875rem] leading-[1.68] text-ink-2">
                <span className="mr-1.5 font-semibold text-accent-ink">{ITEM_COPY.reasonLabel}</span>
                {reason}
              </div>
            )}
          </div>
        </div>

        <footer className="mt-5 flex items-center justify-between gap-3 border-t border-line-soft pt-4 text-[0.8125rem]">
          {lead.group && (lead.group.additionalSourceCount > 0 || lead.group.reportCount > 1) ? (
            <div className="min-w-0 flex-1">
              <GroupSources group={lead.group} parentId={lead.item.id} placement="hero" />
            </div>
          ) : (
            <span className="text-ink-4">编辑部每日精选</span>
          )}
          <span
            data-hero-cta=""
            className="inline-flex shrink-0 items-center gap-1 font-semibold text-accent transition-transform duration-200 group-hover:translate-x-1"
          >
            阅读全文 <IconArrowRight size={14} />
          </span>
        </footer>
      </article>

      {/* Right 5 columns — Stacked Dual Bento */}
      <div className="flex flex-col gap-4 lg:col-span-5">
        {/* Top Card — Signature Deep-Jade Daily Briefing */}
        <section
          data-hero-daily=""
          aria-label="每日情报日报"
          className="relative flex flex-col justify-between overflow-hidden rounded-[16px] p-5 wide:p-6"
        >
          <div className="relative z-[1]">
            <div className="flex items-center justify-between gap-2 text-[0.75rem]">
              <span className="font-semibold tracking-[0.08em] opacity-90">每日情报日报</span>
              <span
                data-hero-daily-pill=""
                className="num rounded-full border border-white/15 bg-white/12 px-2.5 py-0.5 text-[0.75rem] font-medium"
              >
                {issue ? `第 ${issue.issueNumber} 期` : "每日更新"}
              </span>
            </div>

            <h2 className="mt-3 font-serif text-[1.25rem] font-bold leading-[1.38]">
              {issue && issue.key === today
                ? "今日教育 AI 核心脉络"
                : issue
                  ? `${issue.key} 每日刊期速览`
                  : "教育 AI 每日精炼简报"}
            </h2>

            <p data-hero-daily-sub="" className="mt-2 text-[0.875rem] leading-[1.65]">
              {todayCount > 0
                ? `今日已精选 ${todayCount} 条高价值行业进展，汇总头部机构动向、产品实测与政策解读。`
                : "每日汇聚国内外 50+ 教育科技与官方信源，提炼最值得读的一手进展。"}
            </p>
          </div>

          <div className="relative z-[1] mt-4 flex flex-wrap items-center gap-3">
            <Link
              data-hero-daily-btn=""
              to={issue ? `/daily/${issue.key}` : "/daily"}
              className="inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-[0.8125rem] font-semibold transition-transform duration-200 hover:-translate-y-px"
            >
              阅读本期日报 <IconArrowRight size={13} />
            </Link>
            <Link
              data-hero-daily-link=""
              to="/daily/archive"
              className="text-[0.8125rem] font-medium underline-offset-4 hover:underline"
            >
              往期归档
            </Link>
          </div>
        </section>

        {/* Bottom Card — 48h Hot Pulse (or 2x2 Intelligence Radar fallback) */}
        <section
          data-hero-hot=""
          aria-label="48 小时热点脉冲"
          className="flex flex-1 flex-col rounded-[16px] border border-line bg-surface p-5"
        >
          {hot.length > 0 ? (
            <>
              <div className="flex items-baseline gap-2">
                <h2 className="font-serif text-[1rem] font-bold text-ink">热点榜</h2>
                <span className="text-[0.75rem] text-ink-4">近 48 小时</span>
                <Link
                  to="/hot"
                  className="ml-auto text-[0.75rem] font-semibold text-accent transition-colors hover:text-accent-ink"
                >
                  完整榜单 →
                </Link>
              </div>
              <ol className="mt-2.5 divide-y divide-line-soft">
                {hot.slice(0, 3).map((item) => (
                  <li key={item.rank}>
                    <Link
                      viewTransition
                      to={item.to}
                      className="group -mx-2 flex items-start gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-bg-muted"
                    >
                      <span className="mono mt-0.5 shrink-0 text-[0.8125rem] font-bold text-accent">
                        {String(item.rank).padStart(2, "0")}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-2 block text-[0.875rem] font-medium leading-[1.45] text-ink transition-colors group-hover:text-accent">
                          <WordTitle>{item.title}</WordTitle>
                        </span>
                        {item.sources && (
                          <span className="mt-0.5 block truncate text-[0.75rem] text-ink-4">
                            {item.sources}
                          </span>
                        )}
                      </span>
                    </Link>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <>
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="font-serif text-[1rem] font-bold text-ink">深度情报雷达</h2>
                <span className="text-[0.75rem] text-ink-4">实时追踪</span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2.5">
                {FALLBACK_RADAR.map((tile) => (
                  <Link
                    key={tile.to}
                    to={tile.to}
                    className="group flex flex-col gap-1 rounded-xl border border-line-soft bg-bg/60 p-3 transition-all duration-200 hover:-translate-y-px hover:border-line-strong hover:bg-bg-muted"
                  >
                    <span className="flex items-center gap-1.5 text-[0.8125rem] font-semibold text-ink transition-colors group-hover:text-accent">
                      <tile.icon size={15} className="shrink-0 text-accent" />
                      <span className="truncate">{tile.label}</span>
                    </span>
                    <span className="truncate text-[0.75rem] text-ink-4">{tile.desc}</span>
                  </Link>
                ))}
              </div>
            </>
          )}
        </section>
      </div>
    </section>
  );
}
