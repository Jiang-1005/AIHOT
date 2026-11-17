// The home page's masthead, as a newspaper's: the site's name over a double rule, and one line with the
// latest daily's issue number, today's date and today's count of selected reports. Every figure comes from
// the data (the daily index, the timeline's day counts); nothing is shown that the data does not hold.
import { Link } from "react-router";
import { SITE } from "@aihot/site";
import { beijingAt, beijingWeekday } from "@aihot/contracts/time";
import { monthDay } from "../../lib/format";

export interface MastheadIssue {
  /** The latest daily's date (YYYY-MM-DD) and its place among the dailies ("第 N 期"). */
  key: string;
  issueNumber: number;
}

export function Masthead({ today, issue, todayCount }: { today: string; issue: MastheadIssue | null; todayCount: number }) {
  const noon = beijingAt(today, "12:00").getTime();
  const date = monthDay(today, noon);
  return (
    // Phones: the name and the issue line share a row when they fit (360–390), and the issue line wraps
    // under the name at 320 so "最新第 N 期 · 日期 · 今日 N 条" cannot cover the wordmark. Desktop: centred,
    // the tagline over the name, the spaced issue line under a hairline, all over a double rule.
    <header data-masthead="" className="mb-1 mt-2 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1 border-b border-ink pb-2 lg:mb-6 lg:mt-1 lg:block lg:border-b-[3px] lg:border-double lg:pb-4 lg:text-center">
      <p className="kicker hidden font-normal lg:block">{SITE.tagline} · 每日精选</p>
      <p data-masthead-name="" className="shrink-0 font-serif text-[1.25rem] font-black leading-[1.2] tracking-[0.02em] text-ink lg:mt-2 lg:text-[2.75rem] lg:leading-[1.15] lg:tracking-[0.06em]">{SITE.name}</p>
      <p className="kicker ml-auto flex min-w-0 flex-nowrap items-center justify-end gap-x-1 whitespace-nowrap text-[0.75rem] font-normal tracking-normal lg:mt-3 lg:flex-wrap lg:justify-center lg:gap-x-2 lg:border-t lg:border-line lg:pt-2 lg:tracking-[0.18em]">
        {issue && (
          <Link to={`/daily/${issue.key}`} className="transition-colors hover:text-accent">
            {issue.key === today ? <span className="hidden lg:inline">第 </span> : <>最新<span className="hidden lg:inline">日报</span>第<span className="hidden lg:inline"> </span></>}
            <span className="num">{issue.issueNumber}</span>
            <span className="hidden lg:inline"> </span>期
            {issue.key !== today && <span className="hidden lg:inline">（{monthDay(issue.key, noon)}）</span>}
          </Link>
        )}
        {issue && <span aria-hidden="true">·</span>}
        <time dateTime={today}>
          {date}
          <span className="hidden lg:inline"> {beijingWeekday(today)}</span>
        </time>
        <span aria-hidden="true">·</span>
        <span>
          今日<span className="hidden lg:inline"> </span>
          <span className="num">{todayCount}</span>
          <span className="hidden lg:inline"> </span>条
        </span>
      </p>
    </header>
  );
}
