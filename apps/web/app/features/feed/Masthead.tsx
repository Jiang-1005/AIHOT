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
    <header className="mb-4 mt-5 border-b-[3px] border-double border-ink pb-3 text-center lg:mb-6 lg:mt-1 lg:pb-4">
      <p className="kicker font-normal">{SITE.tagline} · 每日精选</p>
      <p className="mt-1 font-serif text-[2rem] font-bold leading-[1.15] tracking-[0.06em] text-ink lg:mt-2 lg:text-[2.75rem]">{SITE.name}</p>
      <p className="kicker mt-3 flex flex-wrap items-center justify-center gap-x-2 border-t border-line pt-2 font-normal">
        {issue && (
          <Link to={`/daily/${issue.key}`} className="transition-colors hover:text-accent">
            {issue.key === today ? "第" : "最新日报第"} <span className="num">{issue.issueNumber}</span> 期
            {issue.key !== today && `（${monthDay(issue.key, noon)}）`}
          </Link>
        )}
        {issue && <span aria-hidden="true">·</span>}
        <time dateTime={today}>{date} {beijingWeekday(today)}</time>
        <span aria-hidden="true">·</span>
        <span>今日 <span className="num">{todayCount}</span> 条</span>
      </p>
    </header>
  );
}
