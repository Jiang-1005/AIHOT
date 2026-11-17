// One report in a feed. Desktop (≥ 700px): a ruled row beside the time column (editorial: no card box). Phones: a compact row with
// the time in the source line, the bookmark at hand, the reason in one line and duplicate reports
// behind one button that opens a sheet. One markup, two presentations. The card is a link as a whole, so
// addresses in its text read short as plain words.
import { memo } from "react";
import { shortAddresses } from "@aihot/contracts/addresses";
import { Link } from "react-router";
import { IntentLink } from "../../components/ui/IntentLink";
import type { GroupInfo, FeedItemSummary, TimelineFilters } from "@aihot/contracts/site";
import { CATEGORY_LABELS } from "@aihot/contracts/taxonomy";
import { ITEM_COPY } from "@aihot/site";
import { publicCopy } from "../../lib/public-copy";
import { SameEventBadge, SelectedBadge } from "../../components/ui/Badge";
import { ScoreLabel } from "../../components/ui/Score";
import { rowDates } from "../../lib/format";
import { MediaThumbs, SourceLine, StarButton, readTone } from "./parts";
import { GroupButton, GroupSources } from "./ReadingGroup";
import { QuotedLine } from "../item/QuotedPost";
import { rememberPreview } from "../item/preview";

export interface FeedItemProps {
  item: FeedItemSummary;
  group?: GroupInfo | null;
  filters?: TimelineFilters;
  read?: boolean;
  onOpen?: (id: string) => void;
  /** Show category and tags under the text (全部动态, topics, search). */
  showTags?: boolean;
  /** The time the item sits at in its list; phones show it in the source line (desktop: on the rail). */
  at?: string;
}

export const FeedItem = memo(function FeedItem({ item, group, filters, read = false, onOpen, showTags = false, at }: FeedItemProps) {
  const isX = item.channel === "x" && !!item.x;
  const open = () => {
    rememberPreview(item);
    onOpen?.(item.id);
  };
  const showSources = !!group && (group.additionalSourceCount > 0 || group.reportCount > 1);
  const tags = showTags ? item.tags.slice(0, 3) : [];
  // Phones lead with the publish date in the source line; when the row was collected on a later day, "收录 09:42" follows.
  const dates = at ? rowDates(item.publishedAt, at) : null;
  // Under a day head of another day, the date says what it is: "发布 11月13日".
  const lead = dates && [dates.day && `发布 ${dates.day}`, dates.clock].filter(Boolean).join(" ");

  return (
    <article className="relative min-w-0 lg:border-t lg:border-line lg:py-6 lg:group-first/slot:border-t-0 lg:group-first/slot:pt-4 lg:[&:has(a:hover)_h3]:text-accent" data-item-id={item.id} data-feed-card="">
      <header className="flex min-h-5 items-center gap-2 text-[0.75rem] leading-[1.5] text-ink-4 lg:min-h-5 lg:gap-2">
        <SourceLine item={item} className="text-ink-4" />
        {lead && (
          <time dateTime={item.publishedAt ?? at} className="mono shrink-0 text-[0.75rem] lg:hidden">
            · {lead}
          </time>
        )}
        {item.selected && (
          <span className="hidden lg:inline-flex">
            {item.sameEvent ? <SameEventBadge /> : <SelectedBadge />}
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1 pl-2 lg:gap-2">
          <span className="hidden lg:inline-flex">
            <ScoreLabel score={item.score} />
          </span>
          <span className="lg:hidden">
            <ScoreLabel score={item.score} compact />
          </span>
          <span className="-my-[12px] -mr-3 inline-flex lg:-my-1 lg:mr-0">
            <StarButton item={item} className="size-11 lg:-my-2 lg:size-8" />
          </span>
        </span>
      </header>
      {dates?.collected && <p className="mono text-[0.75rem] leading-[16px] text-ink-4 lg:mt-1">{dates.collected}</p>}

      {isX ? (
        item.summary ? <p className={`mt-2 whitespace-pre-line text-[0.875rem] leading-[1.7] line-clamp-5 lg:mt-2 lg:line-clamp-4 ${readTone(read, "text-ink")}`}>
          <IntentLink viewTransition to={`/items/${item.id}`} onClick={open} className="after:absolute after:inset-0 after:content-['']">
            {shortAddresses(item.summary)}
          </IntentLink>
        </p> : <IntentLink viewTransition to={`/items/${item.id}`} onClick={open} aria-label={`查看 ${item.x!.authorName} 的帖子`} className="absolute inset-0" />
      ) : (
        <>
          <h3 className={`mt-1.5 line-clamp-2 text-[1rem] font-semibold leading-[1.45] transition-colors duration-150 lg:mt-2.5 lg:line-clamp-none lg:text-[1.25rem] ${readTone(read, "text-ink")}`}>
            <IntentLink viewTransition to={`/items/${item.id}`} onClick={open} className="after:absolute after:inset-0 after:content-['']">
              {item.title}
            </IntentLink>
          </h3>
          {item.summary && <p className="mt-1 line-clamp-2 text-[0.875rem] leading-[1.7] text-ink-3 lg:mt-2 lg:line-clamp-3">{shortAddresses(item.summary)}</p>}
        </>
      )}

      {isX && item.x!.media.length > 0 && <MediaThumbs media={item.x!.media} className="mt-3" />}
      {isX && item.x!.quoted?.text && <QuotedLine quoted={item.x!.quoted} />}

      {(tags.length > 0 || (showTags && item.category)) && (
        <div className="relative z-10 mt-2 hidden flex-wrap gap-x-3 gap-y-1 text-[0.75rem] text-ink-4 lg:flex">
          {showTags && item.category && (
            <Link to={`/all?category=${item.category}`} className="hover:text-accent">
              {CATEGORY_LABELS[item.category]}
            </Link>
          )}
          {tags.map((t) => (
            <Link key={t} to={`/all?tag=${encodeURIComponent(t)}`} className="hover:text-accent">
              #{t}
            </Link>
          ))}
        </div>
      )}

      {item.sameEvent && (
        <p className="relative z-10 mt-2 line-clamp-1 text-[0.875rem] text-ink-4">
          同一件事，精选收录的是
          <Link viewTransition to={`/items/${item.sameEvent.id}`} className="text-ink-3 transition-colors hover:text-accent">
            《{item.sameEvent.title}》
          </Link>
        </p>
      )}
      {group && showSources && (
        <div className="mt-2 hidden lg:block">
          <GroupSources group={group} filters={filters} parentId={item.id} />
        </div>
      )}

      {item.reason && (
        <div className="mt-1 lg:mt-3 lg:border-t lg:border-line-soft lg:pt-3">
          <p className="line-clamp-1 text-[0.875rem] leading-[1.7] text-note lg:line-clamp-none">{`${ITEM_COPY.reasonLabel}：`}{publicCopy(item.reason)}</p>
        </div>
      )}

      {/* Phones: duplicate reports open in a sheet. */}
      {group && showSources && <GroupButton group={group} filters={filters} parentId={item.id} />}
    </article>
  );
});
