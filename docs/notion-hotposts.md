# Notion 热帖快照

2026-11-24 起，X 和小红书的正式内容源是 Notion 数据库「AI 教育热帖」。飞书目录和 `grok-posts.json` 不再覆盖站点热帖。导入员仍是唯一把热帖写入生产库的人。内容雷达仍是唯一把日常 X 写入 Notion 的人。本文件不改 9:30 / 20:30 的定时任务。

这里有两份文件，不要混成一份：

1. **连接器分页**（`notion-connector-pagination-v1`）。上游用本 bot 的官方 Notion 连接器，对下面这个视图做全量分页后，把每一页的行原样收进一个 JSON。行的形状以连接器实际返回为准（扁平属性名，见 `scripts/fixtures/notion-hotposts/connector-pages.json`）。本仓库不调用 Notion 的私有 API，也不读取令牌。
2. **站点快照**（`edu-hot-notion-hotposts-snapshot-v1`）。`notion-hotposts-snapshot.py seal` 检查分页完整之后写出。导入只读这份快照。

库：<https://app.notion.com/p/42234f5efb6e81ed86dcf9223807d9d4>

- database_id：`42234f5e-fb6e-81ed-86dc-f9223807d9d4`
- data_source：`collection://42234f5e-fb6e-8142-814f-000b742fd940`
- 视图：`view://42234f5e-fb6e-81b6-bb70-000c6b7060aa`
- 查询必须是 `mode=view`、`archive_status=all`。默认视图的筛选不能当成全表。

官方 SQL / rows 查询的额度会用完。额度用完时继续用视图分页，不要为了 SQL 额度去购买 Notion 升级。分页文件本身不消耗 SQL 额度。

## 给上游：封存

连接器每一页收成：

```json
{
  "protocol": "notion-connector-pagination-v1",
  "data_source": "collection://42234f5e-fb6e-8142-814f-000b742fd940",
  "database_url": "https://app.notion.com/p/42234f5efb6e81ed86dcf9223807d9d4",
  "database_id": "42234f5e-fb6e-81ed-86dc-f9223807d9d4",
  "view": "view://42234f5e-fb6e-81b6-bb70-000c6b7060aa",
  "query": {"mode": "view", "archive_status": "all"},
  "fetched_at": "2026-11-24T14:18:35+08:00",
  "declared_n": 541,
  "pages": [
    {"index": 1, "page_size": 100, "has_more": true, "results": []},
    {"index": 2, "page_size": 100, "has_more": false, "results": []}
  ]
}
```

`results[]` 里每个对象是连接器的一行。`url` 是 Notion 页面地址，不是原帖。原帖在 `原帖`，去重键在 `原帖键`（`x:<status id>` 或 `xhs:<笔记 id>`）。

最后一页必须 `has_more=false`，页码从 1 连续，前面每一页的行数等于 `page_size`。中间缺页、最后一页仍 `has_more=true`、原帖键重复、原帖和原帖键对不上，都拒绝封存。只有 `results`、没有 `pages` 的合并文件（包括 2026-11-24 14:16 那份 541 条预写冻结）不能封存，也不能导入。

写后实读的页是官方 view 响应正文的 JSON dumps，不是 MCP 信封。第 1–8 页有 `results`、`has_more: true` 和 `next_cursor`。第 9 页只有 `results` 和 `has_more: false`，没有 `next_cursor` 字段。不要把 meta 里后来整理的 `next_cursor: null` 写回页正文。`cursor-chain.json` 里的请求参数标明为 reconstructed，只用来核对「下一页还原的 start_cursor 等于上一页正文的 next_cursor」，不能称作原始请求。

```bash
python3 /workspace/edu-hot/scripts/notion-hotposts-snapshot.py seal-view-pages \
  --body pages/view-p01.txt --body pages/view-p02.txt --body pages/view-p03.txt \
  --body pages/view-p04.txt --body pages/view-p05.txt --body pages/view-p06.txt \
  --body pages/view-p07.txt --body pages/view-p08.txt --body pages/view-p09.txt \
  --cursor-chain cursor-chain.json \
  --fetched-at 2026-11-24T14:34:48+08:00 \
  --page-size 100 --declared-n 817 \
  --dry-run

python3 /workspace/edu-hot/scripts/notion-hotposts-snapshot.py seal-view-pages \
  --body pages/view-p01.txt --body pages/view-p02.txt --body pages/view-p03.txt \
  --body pages/view-p04.txt --body pages/view-p05.txt --body pages/view-p06.txt \
  --body pages/view-p07.txt --body pages/view-p08.txt --body pages/view-p09.txt \
  --cursor-chain cursor-chain.json \
  --fetched-at 2026-11-24T14:34:48+08:00 \
  --page-size 100 --declared-n 817 \
  --update-policy migration-hold \
  --out /workspace/edu-hot/.data/notion-hotposts/snapshot.json

python3 /workspace/edu-hot/scripts/notion-hotposts-snapshot.py check \
  --snapshot /workspace/edu-hot/.data/notion-hotposts/snapshot.json
```

非最后一页缺游标、行数不够 `page_size`、页码不连续、原帖键重复、还原游标和上一页正文冲突，都拒绝。最后一页 `has_more` 仍为 true，或还带着非空 `next_cursor`，也拒绝。最后一页没有 `next_cursor` 字段是正常终页，不失败。只有合并行、没有逐页正文的文件仍然不能封存。

`--dry-run` 只打印行数和 `rows_sha256`，不写文件。哈希是帖子列表按原帖键排序后的 SHA-256。快照写在 `.data/notion-hotposts/`，不放进 `feishu-edu`，也不伪装成 `xhs-*.json`。

## 字段

| 连接器列 | 快照 / 站点 | 规则 |
|---|---|---|
| 来源平台 | platform | 只收 `X` 和 `小红书` |
| 原帖 + 原帖键 | canonical_url、post_key | 两者的 id 必须一致。查询串丢掉。站点不使用 Notion 的 `url` |
| 笔记标题、讨论要点 | title、summary | 小红书再经 `scrub-xhs.py`。公开页没有作者、封面、查看入口 |
| date:发布日期:start | published_on、day | 只有这一列。没有就留空 |
| date:采集日期:start | metrics.captured_at | 不拿来填发布日。页面时间、createdTime 都不是发布日 |
| 点赞、收藏、评论、转发 | metrics 里的同名数字 | 列缺失是 null，不写成 0。0 只有列里真是 0 才保留 |
| 互动来源 | metrics.interaction_source | 只留方括号里的来源名，去掉带跟踪参数的链接 |
| 互动口径 | metrics.caption | 原文保留，里面的采样时间不另造 |
| 核验状态、访问状态 | metrics.verification_status、access_status、verified | 见下 |
| 内容类型 | 不直接进 tags.content_type | 见对照表 |
| X 话题 | tags.topic | 只有和站点主题词表完全相同才写入；否则保持待定。方向、主形态不写入主题 |
| X 采集标注 | 只留在快照的 radar_content_type | 不写入站点内容类型 |
| 人群、信源 | source | 原样作来源标签，不改写成另一套身份 |
| 作者、封面、查看入口 | 小红书公开字段里没有 | 作者和图片不进站点 |

已核只在同时满足这四条时为 true：核验状态含「原帖已核」、不含「部分待核」、不含「推断」、访问状态是「原帖已打开」「图文已打开」或「视频已播放」之一。其余都保持未核，原始状态仍写在 metrics 里。`--skip-verify` 不会把未核改成已核，导入也不打开原帖。

内容类型对照在 `scripts/notion-hotposts-content-types.json`。当前每一项都是 `review: unreviewed`，站点类型是 null，导入后 `tags.content_type` 保持待定；如果这条帖在 baseline 里已经有类型，空的待定不会把它擦掉。对照表改成 `accepted` 之后才会写入，并且站点类型必须属于：新闻快讯、官方发布、深度分析、测评体验、研究报告、观点评论、教程与提示词、用户自述。Notion 的「教程」不是「教程与提示词」，「行业资讯」不是「新闻快讯」，「观点讨论」不是「观点评论」，「工具测评」不是「测评体验」。

小红书公开样例（发布日为空，采集日不补上）：

```json
{
  "platform": "小红书",
  "url": "https://www.xiaohongshu.com/explore/6b044b670000000018029cc5",
  "author": "",
  "published_at": null,
  "day": null,
  "verified": true,
  "metrics": {
    "likes": null,
    "collects": 2,
    "captured_at": "2026-11-24",
    "interaction_source": "原帖底栏",
    "verification_status": ["原帖已核"],
    "access_status": "图文已打开"
  },
  "tags": {"content_type": "待定"}
}
```

这条在 2026-11-24 预写冻结里发布日期列不存在，采集日期是 2026-11-24。`verified: true` 是因为表内写了「原帖已核」且访问状态是「图文已打开」，不是导入时重新打开了原帖。

## 给导入员

先有上游封好的快照，再跑。`--baseline` 是当前 `.data/voices.json`。快照里没有、baseline 里有的帖，必须加 `--retain-baseline-union` 才会原样保留；不加就失败，不写文件。这个开关不读取 grok-posts，也不读取飞书。

已经在站点上的帖不被这次迁移整页覆盖。默认 `update_policy` 是 `migration-hold`：正文保留站点版本，因为写后库存里的「讨论要点」比站点摘要短；已有 `verified` 不抬升也不抹掉；已有主题和内容类型不降级。互动数仍只在 Notion 采集日严格晚于站点采样日时更新。快照里新出现的帖用 Notion 正文；内容类型对不上 grok 词表时，保留 Notion 原文并写 `content_type_status: unmapped`。发布日仍然只来自发布日期列，缺失就留空。

这次 817 条快照不设置 `accept-newer-sample`。2026-11-24 对照当时的 758 条目录，已有 675 条不改写，新出现 142 条。那是那一天的差集。之后目录变过，导入员用当前 `voices.json` 干跑，按打印的 added、skipped、retained_baseline、changed、duplicates 核对，不把 142 或 675 填成应有的结果。`migration-hold` 仍不改已有正文。后续同一 URL 要能幂等接收更新，封存时加上 `--update-policy accept-newer-sample`。那时只有采集日比卡片上的采样日更晚，才会换上新的标题和摘要；核验和已有分类仍然不降级。同一份快照再跑一次，采集日不再更晚，结果不变。没有这个显式策略时，统一源不会把旧正文盖掉。

```bash
python3 /workspace/edu-hot/scripts/scrub-xhs.py \
  --snapshot /workspace/edu-hot/.data/notion-hotposts/snapshot.json

python3 /workspace/edu-hot/scripts/import-voices.py \
  --notion-snapshot /workspace/edu-hot/.data/notion-hotposts/snapshot.json \
  --baseline /workspace/edu-hot/.data/voices.json \
  --retain-baseline-union \
  --cn /workspace/edu-hot/.data/cn-community-inbox.json \
  --dry-run

python3 /workspace/edu-hot/scripts/import-voices.py \
  --notion-snapshot /workspace/edu-hot/.data/notion-hotposts/snapshot.json \
  --baseline /workspace/edu-hot/.data/voices.json \
  --retain-baseline-union \
  --cn /workspace/edu-hot/.data/cn-community-inbox.json
```

标准输出是一行 JSON：`added`、`changed`、`skipped`、`retained_baseline`、`duplicates`。`duplicates` 必须是 0。退出码不是 0 时不写 `voices.json`。非 dry-run 的失败会把导入戳记写成 `ok: false`。`sync-to-neon.sh` 只在这个戳记文件已经存在时才核对它；没有戳记的媒体、公司或政策同步不会被热帖门挡住。戳记存在但不是 ok，或哈希和当前快照不一致，才在读取数据库连接之前停下。

同一条原帖再跑一次：`added=0`、`changed=0`、`duplicates=0`，URL 集合不变。快照里同一条帖的标题、互动数以快照为准；发布日如果快照是空的，而 baseline 里已经有日期，就留下 baseline 的日期，仍然不用采集日去填。

知乎、微博、即刻、豆瓣、B 站不在这个 Notion 库里，继续用 `--cn`。baseline 里已有的这些帖同样靠 `--retain-baseline-union` 保留。

## 健康检查

`check-pipeline-health.py` 的 inputs 组在传入热帖路径时检查两件事：快照能通过 `check`，导入戳记的哈希等于快照哈希。文件还没到，跟原来的雷达截止时刻一样（早 8:40 / 晚 19:35 之后才 FAIL）。文件在但不完整或哈希不符，直接 FAIL。`x-posts-feishu-new-*.csv` 只提示「已不读」。

## 这次还没有做的

- 没有连接 Notion，没有读密钥，没有写生产库，没有跑 Neon 或 Docker 上的导入。
- 2026-11-24 14:16 的 541 条（小红书 381、X 160）是测试用的历史冻结。按 status id 和当时的 grok/站点 430 条比：重合 154、站点有而冻结没有 276、冻结独有 6。那 276 条当时还没全部写入 Notion。这份合并 JSON 被 seal 拒绝。不能用 160 覆盖站点的 430，也不能把 381−245 当成净新增。
- 内容类型对照表全部未审，所以新帖的 `content_type` 是待定。
- 小红书脱敏沿用 `scrub-xhs.py`。学校名替换原先读了不存在的正则分组，碰到校名会中断；已改成读当前这一个分组。公开字段仍只有标题、摘要、链接。
- 导入不重新打开原帖。表内没写成已核的，站点上也不是已核。
