import type { HotEntryView, HotResponse } from "@aihot/contracts/site";
import type { Fallback } from "../presentation";

function entry(
  rank: number,
  publicId: string,
  title: string,
  heat: number,
  sourceNames: string[],
  latestAt: string,
  firstReportAt: string,
  extra: Partial<HotEntryView> = {},
): HotEntryView {
  return {
    rank,
    story: { publicId, title },
    heat,
    trend: "unknown",
    trendPct: null,
    badges: [],
    participantCount: sourceNames.length,
    sourceCount: sourceNames.length,
    sourceNames,
    participants: sourceNames.map((name) => ({ name, kind: "editorial" as const })),
    spark: [],
    summary: null,
    latest: null,
    cover: null,
    latestAt,
    firstReportAt,
    singleSource: sourceNames.length <= 1,
    ...extra,
  };
}

/** Local export as of 2026-11-17 12:59 CST (Asia/Shanghai). Heat is rankingHeatIndex under heat-v2. */
const ENTRIES: HotEntryView[] = [
  // Historical 2-source event (last appeared on the 11-12 list). Kept first so the preview can show「2 个来源」.
  entry(1, "67f009ad-6780-4abb-9e12-344321981e63", "发改委：幼儿园至初中学龄人口达峰，将扩高中及高教学位", 1.5, ["中新网教育新闻", "芥末堆"], "2026-11-10T09:22:49.000Z", "2026-11-10T07:26:22.000Z"),
  entry(2, "6c2ef478-dac2-4a16-9918-6819fb76200b", "孙宏艳：警惕未成年人AI过度依赖", 0.8, ["光明日报"], "2026-11-16T16:00:00.000Z", "2026-11-16T16:00:00.000Z", { badges: ["new"] }),
  entry(3, "c73e1b15-033d-4108-ace6-f0484630dc07", "GET2026议程公布，聚焦教育存量竞争", 0.8, ["芥末堆"], "2026-11-16T16:00:00.000Z", "2026-11-16T16:00:00.000Z", { badges: ["new"] }),
  entry(4, "1e8c830f-b029-4bba-847d-81df21b6ec87", "北京市教委印发中小学AI通识课程教学指导手册", 0.1, ["北京师范大学未来教育高精尖创新中心"], "2026-11-15T16:00:00.000Z", "2026-11-15T16:00:00.000Z"),
  entry(5, "a3fdf294-f2dd-491c-b0ce-b1f2ca426290", "AI Opportunity Fund第三期选定28家亚太伙伴", 0.1, ["ANTARA News"], "2026-11-15T16:00:00.000Z", "2026-11-15T16:00:00.000Z"),
  entry(6, "396d2b6f-a23c-4a46-9aa4-e8f30605217c", "ST豆神单日涨15.08%，前三季净利降98.59%", 0.1, ["新浪证券-红岸工作室"], "2026-11-15T16:00:00.000Z", "2026-11-15T16:00:00.000Z"),
  entry(7, "61281907-6daf-42fe-9f3d-4a6a5bc5143b", "台南办家长宣讲，示范AI学伴引导解题", 0.1, ["ETtoday新聞雲"], "2026-11-15T16:00:00.000Z", "2026-11-15T16:00:00.000Z"),
  entry(8, "d00cd02f-e079-4fad-8814-8c6e5c377124", "多邻国称将持续加大在华投资", 0.1, ["中国日报网"], "2026-11-15T16:00:00.000Z", "2026-11-15T16:00:00.000Z"),
  entry(9, "3b99beeb-f46f-478e-9859-8d852db6f17d", "读书郎港股11月16日收盘跌17.09%", 0.1, ["证券之星"], "2026-11-15T16:00:00.000Z", "2026-11-15T16:00:00.000Z"),
  entry(10, "1d8a7173-1c0f-4fc5-9af7-3f2c88905242", "高盛研报看好中国教育AI学习应用", 0.1, ["阿思达克"], "2026-11-15T16:00:00.000Z", "2026-11-15T16:00:00.000Z"),
];

const FALLBACK_ITEMS = [
  { id: "zbg9yu8026a0hy6lrvz87tcny", title: "孙宏艳：警惕未成年人AI过度依赖，守住“健康第一”成长底线", sourceName: "光明日报", at: "2026-11-17T01:41:44.216Z", selected: true },
  { id: "zc3nncvd326cy46f3b5x7q389", title: "北京市教委印发《北京市中小学人工智能通识课程教学指导手册》", sourceName: "北京师范大学未来教育高精尖创新中心", at: "2026-11-16T12:42:31.636Z", selected: true },
  { id: "v0x8g96rtcba1h2j4fw5si8q3", title: "韩国大考防AI作弊：考生眼镜逐一检查，拟延长禁考期限", sourceName: "中央社", at: "2026-11-16T12:42:31.574Z", selected: true },
  { id: "bhoec1u8kr0jm6l5svxpbsruz", title: "济南市市中区发布义务教育阶段人工智能教育实施规划（2026－2030）", sourceName: "新时报", at: "2026-11-16T01:48:13.525Z", selected: true },
  { id: "woeul3y5v5e584c3jkf8z7a1d", title: "韩国注册税务师考试第一名承认用AI作弊，青瓦台紧急商议对策", sourceName: "光明网", at: "2026-11-16T01:48:13.512Z", selected: true },
  { id: "bzflzanfoeoanlywyyzt0uv4t", title: "读卖新闻连载：日本中学生用ChatGPT写作业，思考外包引发担忧", sourceName: "読売新聞", at: "2026-11-16T01:48:13.415Z", selected: true },
  { id: "qyfvw3t0b8ecwzmoo14vb66bj", title: "昆山市教育局为全市2.7万名教师配备腾讯WorkBuddy", sourceName: "芥末堆", at: "2026-11-15T12:37:59.699Z", selected: true },
  { id: "k5swqewt7k7wbvxlwujxggxfd", title: "Alpha School内部数据：仅42%学生数学和阅读双达标", sourceName: "Fortune", at: "2026-11-15T04:22:49.628Z", selected: true },
];

export function hotPreviewFixture(): HotResponse {
  return { computedAt: "2026-11-17T04:59:00.000Z", windowHours: 48, entries: ENTRIES };
}

export function hotPreviewFallback(): Fallback {
  return { kind: "featured", items: FALLBACK_ITEMS };
}
