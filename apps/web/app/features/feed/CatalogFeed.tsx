import { byBeijingDay } from "../../lib/format";
import { ScoreLabel } from "../../components/ui/Score";
import { DayHeader, TimelineSlot, slotClock } from "./Timeline";

export type CatalogTag = { label: string; href?: string };

export function CatalogFeedItem({
  title,
  url,
  source,
  at,
  summary,
  unverified,
  consultationDraft,
  tags,
  score,
  mobileLeadTag = false,
}: {
  title: string;
  url: string;
  source: string;
  at?: string | null;
  summary?: string | null;
  unverified?: boolean;
  consultationDraft?: boolean;
  tags?: CatalogTag[];
  /** Shown only when the payload already has a score; never invent one. */
  score?: number | null;
  /** On /companies, keep the first tag (company name or 多家) visible below `lg`. */
  mobileLeadTag?: boolean;
}) {
  const clock = slotClock(at);
  const text = summary?.trim() ?? "";
  const visibleTags = (tags ?? []).filter((tag) => tag.label);
  const hasMarks = Boolean(unverified || consultationDraft || score != null);
  return (
    <article className="relative min-w-0 lg:card lg:card-hover lg:px-[18px] lg:pb-[14px] lg:pt-[15px]">
      <header className="flex min-h-[22px] items-center gap-1.5 text-[12.5px] leading-[18px] text-ink-4 lg:min-h-[18px] lg:gap-2">
        {source ? <span className="min-w-0 truncate">{source}</span> : null}
        {clock ? (
          <time dateTime={at ?? undefined} className="mono shrink-0 text-[12px] lg:hidden">
            · {clock}
          </time>
        ) : null}
        {hasMarks ? (
          <span className="relative z-10 ml-auto flex shrink-0 items-center gap-1.5">
            {unverified ? <span className="soft-tag soft-tag-warn">未查到原文</span> : null}
            {consultationDraft ? (
              <span className="soft-tag" title="征求意见稿，未施行">
                未施行
              </span>
            ) : null}
            {score != null ? <ScoreLabel score={score} /> : null}
          </span>
        ) : null}
      </header>
      <h3 className="mt-1.5 line-clamp-2 text-[17px] font-[650] leading-[1.5] text-ink lg:mt-2 lg:line-clamp-none lg:leading-[1.55]">
        <a href={url} target="_blank" rel="noopener noreferrer" className="text-inherit no-underline after:absolute after:inset-0 after:content-['']">
          {title}
        </a>
      </h3>
      {text ? <p className="mt-1 line-clamp-2 text-[14.5px] leading-[1.7] text-ink-3 lg:mt-2 lg:text-[15px] lg:leading-[1.75]">{text}</p> : null}
      {visibleTags.length > 0 ? (
        <div className={`relative z-10 mt-2 flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-ink-4 ${mobileLeadTag ? "flex" : "hidden lg:flex"}`}>
          {visibleTags.map((tag, i) => {
            const className = mobileLeadTag && i > 0 ? "max-lg:hidden" : undefined;
            return tag.href ? (
              <a key={`#${tag.label}`} href={tag.href} className={`min-w-0 max-w-full truncate text-ink-4 no-underline transition-colors hover:text-accent ${className ?? ""}`.trim()}>
                #{tag.label}
              </a>
            ) : (
              <span key={`#${tag.label}`} className={`min-w-0 max-w-full truncate ${className ?? ""}`.trim()}>
                #{tag.label}
              </span>
            );
          })}
        </div>
      ) : null}
    </article>
  );
}

export function CatalogDayList<T>({
  items,
  today,
  dayOf,
  atOf,
  keyOf,
  render,
}: {
  items: readonly T[];
  today: string;
  dayOf: (item: T) => string;
  atOf: (item: T) => string;
  keyOf: (item: T) => string;
  render: (item: T) => React.ReactNode;
}) {
  const days = byBeijingDay(items, (item) => dayOf(item));
  return (
    <>
      {days.map(({ day, entries }) => (
        <section key={day} className="mt-5 first:mt-0 lg:mt-6">
          <DayHeader day={day} today={today} count={entries.length} />
          <ol className="lg:pt-1">
            {entries.map((item) => (
              <TimelineSlot key={keyOf(item)} at={atOf(item)}>
                {render(item)}
              </TimelineSlot>
            ))}
          </ol>
        </section>
      ))}
    </>
  );
}

export function companyCatalogTags(item: { multiCompany?: boolean; companies?: { id: string; name: string }[] }): CatalogTag[] {
  const tags: CatalogTag[] = [];
  if (item.multiCompany) tags.push({ label: "多家" });
  const seen = new Set<string>();
  for (const company of item.companies ?? []) {
    const name = (company.name ?? "").trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    tags.push({ label: name, href: `/companies?view=company&company=${encodeURIComponent(name)}` });
  }
  return tags;
}
