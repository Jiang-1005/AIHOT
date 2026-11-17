// The event page's「全部来源」rail rows. Plain createElement (no JSX) so node:test can render it directly.
import { createElement as h, type ReactElement } from "react";
import { Link } from "react-router";
import type { StoryDetail, StorySource } from "@aihot/contracts/site";
import { monthDayTime } from "../../lib/format.ts";

export const MISSING_URL_LABEL = "原文链接缺失";

export interface SourceRow {
  name: string;
  itemId: string;
  publishedAt: string;
  /** Original article URL, or null when the report has none. */
  url: string | null;
  /** Host shown next to the original link, e.g. jiemodui.com. */
  host: string | null;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function toRow(s: StorySource): SourceRow {
  const url = s.url && /^https?:\/\//i.test(s.url) ? s.url : null;
  const host = url ? hostOf(url) : null;
  return { name: s.name, itemId: s.itemId, publishedAt: s.publishedAt, url: host ? url : null, host };
}

/** API sources when present; otherwise one row per timeline source (no original URL there). */
export function sourceRows(story: Pick<StoryDetail, "sources" | "timeline">): SourceRow[] {
  if (story.sources && story.sources.length > 0) return story.sources.map(toRow);
  const seen = new Map<string, SourceRow>();
  for (const r of story.timeline) {
    if (seen.has(r.source.name)) continue;
    seen.set(r.source.name, { name: r.source.name, itemId: r.id, publishedAt: r.publishedAt, url: null, host: null });
  }
  return [...seen.values()];
}

/** One row: media name, its original article (new tab), the on-site report page, and the time. */
export function SourceList({ rows }: { rows: readonly SourceRow[] }): ReactElement {
  return h(
    "ul",
    { className: "divide-y divide-line-soft", "data-testid": "story-sources" },
    rows.map((s) =>
      h(
        "li",
        { key: `${s.name}-${s.itemId}`, className: "py-3", "data-source-row": "" },
        h(
          "div",
          { className: "flex items-baseline justify-between gap-3" },
          h("span", { className: "min-w-0 text-[0.875rem] font-semibold text-ink" }, s.name),
          h("time", { className: "shrink-0 text-[0.75rem] text-ink-4 num", dateTime: s.publishedAt }, monthDayTime(s.publishedAt)),
        ),
        h(
          "div",
          { className: "mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.8125rem]" },
          s.url
            ? h(
                "a",
                {
                  href: s.url,
                  target: "_blank",
                  rel: "noopener",
                  "data-original-link": "",
                  "aria-label": `${s.name} 原文（新窗口打开）`,
                  className: "min-w-0 break-all text-accent transition-colors hover:text-accent-ink",
                },
                `阅读原文 · ${s.host} ↗`,
              )
            : h("span", { className: "text-ink-4", "data-original-missing": "" }, MISSING_URL_LABEL),
          h(Link, { viewTransition: true, to: `/items/${s.itemId}`, className: "text-ink-3 transition-colors hover:text-accent" }, "站内条目"),
        ),
      ),
    ),
  );
}
