// 精选的门槛。评分标准本身写在 prompts/selection-score.md；这里只决定“多少分算入选”。
// 每篇资料由评分模型独立打两次分（0–100），两次之和 ≥ 2 × 门槛才成为精选候选；
// 确认新闻身份与新增价值后，由发布规则决定展示（见 docs/selection.md），卡片上显示两次的平均分。
// 所有信源共用一个门槛；不再按分级或类别分档。
// 改了门槛或评分提示词，用 scripts/eval-selection.ts 在你自己标注的样本上重跑一遍，再决定上线（见 docs/selection.md）。

export const SELECTION = {
  /**
   * 所有参与精选的信源共用这一个门槛（两次评分的平均分）。不再按 T1/T2 或厂商博客等类别分档。
   * 分级 EXCLUDE_MP 以及未列入 scoredTiers 的分级，不参与精选评分（只进“全部动态”）。
   */
  threshold: 60,
  /** 会按上面的统一门槛评分、参与精选的信源分级。 */
  scoredTiers: ["T1", "T1_5", "T2"] as const,
  /**
   * 信源类别只作后台标注，不再抬高或降低精选门槛。
   */
  classes: {
    "general-media": { label: "综合教育媒体" },
    "vendor-blog": { label: "厂商博客" },
  } as Record<string, { label: string }>,
  /**
   * 首页「精选」只收「稿件 dateline」（文内/URL 标注的出版日，按北京日历日）落在这个窗口内的报道。
   * 窗口天数只在这一处配置。
   */
  featuredMaxAgeDays: 7,
  /**
   * 通过门槛与核验、dateline 超过精选窗口但不超过这个天数的报道，进入「往期」页，不出现在首页精选。
   * 超过这个窗口的不进入精选或往期。
   */
  archiveMaxAgeDays: 30,
  /**
   * 没入选、但平均分高于这个数的资料，也用精选的写法（内容理解：标题、摘要、推荐理由）来写，
   * 其余用更便宜的“标题摘要翻译”。
   */
  understandFloor: 48,
  /**
   * 浏览“全部动态”（网页列表、接口和 RSS 的全部模式）只出平均分不低于这个数的资料，没评上分的照常出；
   * 搜索仍覆盖全部。低于 40 分的多是转述和资讯账号的刷屏（曾占全部动态三分之一以上），精选从没收过 60 分以下的。
   */
  browseFloor: 35,
} as const;


/**
 * 「关注机构」相关性加分（可选）：加在两次评分的平均分（base）之后，再与门槛比较；结果封顶 100。
 * 关注对象和产品锚点写在 industry/prompts/focus-relevance.md；默认没有配置关注机构，
 * 模型一律输出 none，加分恒为 0，精选只看 attentionScore。
 * 模型只判断档位，不自己加分。两轮判断不一致时取更低一档。
 *   direct     +8  原文事实可直接对照关注机构的产品决策
 *   plausible  +5  方法可迁移到这些场景，但原文不是直接在讲这些产品点
 *   none        0  仅同属本行业
 */
export const RELEVANCE_BONUS = { direct: 8, plausible: 5, none: 0 } as const;
export type FocusRelevance = keyof typeof RELEVANCE_BONUS;

/**
 * 关注机构加分的总开关。默认关：模型即使写了 direct / plausible，也只记录档位，不加分，
 * 精选和排序只看 attentionScore。配置好 focus-relevance.md 并重新校准门槛后再打开。
 */
export const FOCUS_RELEVANCE_ENABLED = false;

export function relevanceBonus(level: FocusRelevance | null | undefined): number {
  if (!FOCUS_RELEVANCE_ENABLED) return 0;
  return level && Object.hasOwn(RELEVANCE_BONUS, level) ? RELEVANCE_BONUS[level] : 0;
}

/** 两轮判断不一致时取更低一档，避免把加分抬高。 */
export function conservativeRelevance(levels: Array<FocusRelevance | null | undefined>): { level: FocusRelevance; bonus: number } {
  const order: Record<FocusRelevance, number> = { none: 0, plausible: 1, direct: 2 };
  const known = levels.filter((l): l is FocusRelevance => l === "direct" || l === "plausible" || l === "none");
  if (!known.length) return { level: "none", bonus: 0 };
  const level = known.reduce((a, b) => (order[a] <= order[b] ? a : b));
  return { level, bonus: relevanceBonus(level) };
}

/** 展示分与入选分：base（两次平均向下取整）+ 相关性加分，封顶 100。 */
export function featuredFinalScore(base: number, bonus: number): number {
  return Math.min(100, Math.max(0, Math.floor(base) + bonus));
}


const BEIJING_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" });

/** 北京日历日，YYYY-MM-DD。 */
export function beijingCalendarDay(at: Date): string {
  return BEIJING_DAY.format(at);
}

/**
 * 精选用的稿件 dateline：优先用 URL 里明确的 /YYYY/MM/DD/（常见于原文路径），
 * 否则用 publication_time 的日历日（仅有日期时）或 published_at 的北京日历日。
 * 不用发现时间，免得晚抓到的旧稿混进窗口。
 */
export function featuredDatelineDay(input: { url?: string | null; publicationTime?: string | null; publishedAt?: Date | string | null }): string | null {
  const fromUrl = /(?:https?:\/\/[^/]+)?\/(20\d{2})\/(\d{2})\/(\d{2})(?:\/|$)/.exec(input.url ?? "");
  if (fromUrl) return `${fromUrl[1]}-${fromUrl[2]}-${fromUrl[3]}`;
  const pub = (input.publicationTime ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(pub)) return pub;
  const at = pub ? new Date(pub) : input.publishedAt ? new Date(input.publishedAt) : null;
  if (at && Number.isFinite(at.getTime())) return beijingCalendarDay(at);
  return null;
}

/** dateline 的北京日历日是否落在给定窗口内（含边界：今天往前 `days` 天）。没有 dateline 则不算在窗口内。 */
export function isWithinFeaturedWindow(datelineDay: string | null, now = new Date(), days = SELECTION.featuredMaxAgeDays): boolean {
  if (!datelineDay || !/^\d{4}-\d{2}-\d{2}$/.test(datelineDay)) return false;
  const today = beijingCalendarDay(now);
  const age = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${datelineDay}T00:00:00Z`)) / 86_400_000);
  return age <= days;
}

/** 今天相对于 dateline 的日历日差（今天减 dateline）。没有合法 dateline 则返回 null。 */
export function datelineAgeDays(datelineDay: string | null, now = new Date()): number | null {
  if (!datelineDay || !/^\d{4}-\d{2}-\d{2}$/.test(datelineDay)) return null;
  const today = beijingCalendarDay(now);
  return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${datelineDay}T00:00:00Z`)) / 86_400_000);
}

export type FeaturedSlot = "精选" | "往期" | "无";

/**
 * 稿件应落在哪个展示位：首页精选（≤ featuredMaxAgeDays）、往期（超过精选窗口且 ≤ archiveMaxAgeDays）、
 * 或两者都不进（无 dateline、或超过往期窗口）。是否真正入选还要过门槛、核验和归组。
 */
export function featuredSlot(datelineDay: string | null, now = new Date()): FeaturedSlot {
  const age = datelineAgeDays(datelineDay, now);
  if (age === null) return "无";
  if (age <= SELECTION.featuredMaxAgeDays) return "精选";
  if (age <= SELECTION.archiveMaxAgeDays) return "往期";
  return "无";
}
