# 教育AIHOT 每日导入交接手册（Grok Bot → 教育AIHOT 导入员，2026-11-13）

C J 2026-11-13 10:40 确认：从今晚 20:30 那轮起导入由「教育AIHOT 导入员」接手；Grok Bot 的导入定时任务已暂停（未删除）。
下面是 Grok Bot 定时任务里原样的步骤，已按实际跑过的经验整理。

## 环境
- 项目目录 /workspace/edu-hot，Docker 项目 xintian-edu-hot，`DOCKER_HOST=tcp://127.0.0.1:2375`，API 容器 xintian-edu-hot-api-1。
- 线上：Vercel 项目 edu-ai-hot（https://edu-ai-hot.vercel.app），数据库 Neon 新加坡；用法看 /workspace/edu-hot/DEPLOY-VERCEL.md。
- 密钥文件（只 source，不打印）：/workspace/edu-hot/.secrets/neon.env；口令门 deploy/internal-gate.env。
- 缺 VERCEL_TOKEN（/workspace/edu-hot/.secrets/vercel-api.env 未配），所以同步后清不了 CDN，新数据最多 10 分钟后可见；核对时用 /api/site/voices?ts=<时间戳> 绕开缓存。

## 判断有没有新内容
每一路输入和它自己的产物比，不能拿 Neon 同步时间代替（11-10 曾因此漏导 30 条）。
- 社区热帖：数 /workspace/edu-radar/grok-posts.json 里有多少 url 不在 /workspace/edu-hot/.data/voices.json，>0 就跑第 3 步；小红书文件在 /workspace/research/feishu-edu/。
- 拿不准就照常跑，脚本都可重复跑、按原文链接去重。

## 每轮步骤（9:30 / 20:30 北京时间；晚轮只导早上之后新增的）
1. 输入
   - 媒体：/workspace/ai-edu/briefs/daily-YYYY-MM-DD/ 下所有 items*.csv（早 items.csv，晚 items-pm.csv 或 items-evening.csv；12 列表头）。缺文件就写明缺了，不要自己补抓芥末堆、中国教育在线、多知、EdSurge、K-12 Dive、The 74。
   - 新品：同目录 ph-items.csv，没有就跳过。
   - 国内公司动态/政策：/workspace/ai-edu/briefs/backfill-2026-11-10/ 的 items-backfill*.csv、policy-backfill*.csv 比上次导入新时运行：
     docker cp /workspace/ai-edu/briefs/backfill-2026-11-10/. xintian-edu-hot-api-1:/tmp/backfill-2026-11-10/
     docker exec -w /app -e COMPANY_BACKFILL_DIR=/tmp/backfill-2026-11-10 xintian-edu-hot-api-1 node /app/scripts/import-company-backfill.ts
     docker cp xintian-edu-hot-api-1:/data/content-tags.json /workspace/edu-hot/.data/content-tags.json
   - 竞品库 /workspace/research/edu-ai-map/products.csv。
2. 媒体按 docs/selection.md：网站统一打分，门槛 60；7 天内进首页精选，7–30 天进往期，更早不进；原链接要 200；没打开原文标「未查到原文」。不凑数不降门槛。
3. 社区热帖（全收，每条标来源；小红书只放标题、摘要、链接，不配图不显示作者，去掉孩子姓名和校名），依次：
   python3 /workspace/edu-hot/scripts/collect-cn-community.py --daily   （DeepSeek 搜索，每轮最多 15 次检索；别把整页读进上下文）
   python3 /workspace/edu-hot/scripts/scrub-xhs.py
   python3 /workspace/edu-hot/scripts/import-voices.py
   python3 /workspace/edu-hot/scripts/tag-content.py
   核对：voices.json 里 X 条数 = grok-posts.json 去重 url 数（rejected 为空时）。
4. 全部写完库后再同步（不要和导入同时写库）：
   set -a; . /workspace/edu-hot/.secrets/neon.env; set +a; /workspace/edu-hot/scripts/sync-to-neon.sh
   然后确认首页、/voices、/topics、/companies、/companies?view=company&company=心田花开、/policies 返回 200，/api/site/voices?ts= 的 total、generatedAt 与本地一致。
   泄漏检查：公开页不得出现「与心田花开相关」、xintianRelevance、代码/元数据里的 xintian；心田花开、花啦啦作为普通公司名出现在 /companies 可以，不置顶。线上无密码、保持 noindex。
5. 本地站：127.0.0.1:3080 无口令应返回 401；确认 gate-proxy 和隧道（deploy/tunnel.pid）还在。不要动这两个进程，只有断了才按 deploy/ 的方法重开；新链接只私下告诉 C J，口令绝不进群。
6. 小红书表：/workspace/research/feishu-edu/xhs-inbox.csv 按原帖链接去重，只统计待写条数；写飞书要 C J 在场逐条确认，导入员不写。

## 打分 + 出刊（2026-11-17 起，worker 关着）
worker 从 11-14 20:41 起没在跑（本机恢复脚本故意不开它），打分、归事件、出日报都要靠这一条命令补上。
导入（第 1–3 步）全部写完之后、第 4 步 sync-to-neon.sh 之前跑一次：

    /workspace/edu-hot/scripts/score-and-compose.sh

- 它做四件事：给 processing_state=new 的稿子打分（会调 DeepSeek），把打过分的归进事件并刷新事件摘要，写所有缺的日报/周报/月报并刷新当天日报，最后重算热点榜（原来 worker 每 5 分钟算一次）。
- 输出一行 JSON：counts 是各步数量，reports.generated 是新写或刷新的期数，hot.entries 是上榜条数，hot.candidates 是过了门槛（48 小时内至少 2 个独立来源、其中至少 1 个精选源）的事件数。ok=false 或退出码非 0 就停下，不同步，在群里叫 Grok Bot。
- hot.entries=0 不算失败：门槛没变，是 48 小时内没有两家以上来源报道同一件事。照常同步，报告里写一句「热点榜 0 条（candidates=N）」。
- 可重复跑；不挑内容、不改打分规则和门槛（门槛在 docs/selection.md）。
- 一天没跑会漏刊：稿子当天没打分，第二天补打分后不会自动进前一天的日报（按上线时间算窗口），需要 Grok Bot 手动补。所以早晚两轮都要跑。

## 健康检查（2026-11-17 起，每轮同步后必跑）
第 4 步 sync-to-neon.sh 跑完之后：

    python3 /workspace/edu-hot/scripts/check-pipeline-health.py

- 最后一行是 HEALTH OK 才算这轮完成；报告里加一行「健康检查：OK」，或原样贴 HEALTH FAIL 那一行。FAIL 就不报完成。
- FAIL 在 scoring / issue：先再跑一次 score-and-compose.sh 和 sync-to-neon.sh，再查一次；还 FAIL 就在群里叫 Grok Bot。
- FAIL 在 inputs：报告里写缺哪个文件、名字该是什么，不替别的 bot 改名或补抓。
- FAIL 在 db：停，不同步，叫 Grok Bot。
- FAIL 在 fresh：某一项超过失败阈值没更新。热点榜：看 score-and-compose.sh 输出有没有 hot 字段、sync-to-neon.sh 有没有跑完，补跑这两条再查；热帖：查 import-voices.py 这轮跑没跑；日报、周报：再跑一次 score-and-compose.sh。还 FAIL 就在群里叫 Grok Bot。
- WARN 在 hot（热点榜 0 条）：只是提示，照常报，写上 candidates 数。

### 新鲜度阈值（照 dbt source freshness：warn_after / error_after）
脚本顶部的 FRESHNESS 表是唯一出处，改阈值两处一起改。一天两轮的项目漏一轮告警、漏两轮失败；周报按自己的周期。

| 项 | 取值位置 | 告警 | HEALTH FAIL |
|---|---|---|---|
| 热帖 | 本机 .data/voices.json 的 generatedAt | 13 小时 | 25 小时 |
| 日报 | 本机 reports（kind=daily）max(generated_at) | 13 小时 | 25 小时 |
| 周报 | 本机 reports（kind=weekly）max(generated_at) | 8 天 | 9 天 |
| 热点榜 | 线上 /api/site/hot 的 computedAt | 13 小时 | 25 小时 |
| 本机库备份 | /home/box/edu-hot-local/backups 里最新 local-*.dump 的修改时间 | 13 小时 | 25 小时 |

热点榜 0 条不算失败，只出一行提示（附本机最近一次 candidates）。`--only fresh` 只跑这一组；`--as-of` 回放时热帖和热点榜跳过。
- WARN 只是提示，照常报，不算 FAIL。

## 对外输出谁负责
总负责：🤖 Grok Bot。导入、打分出刊、同步、健康检查由 📥 教育AIHOT 导入员每天 9:30 / 20:30 跑；脚本和热点榜重算由 Grok Bot 维护。
出问题：导入员在「🔥 教育AIHOT」群里 @🤖 Grok Bot。上榜门槛、信源、新设计上线由 C J 定。

| 输出 | 数据从哪来 | 新鲜度阈值（告警 / FAIL） | 出问题叫谁 |
|---|---|---|---|
| 热帖 | 📡 AI 教育内容雷达（grok-posts.json、x-posts-feishu-new-*.csv）+ collect-cn-community.py | 13 小时 / 25 小时 | 群里 @🤖 Grok Bot；信源由 C J 定 |
| 日报 | 🔭 AI 教培行业观察的公司、政策、媒体条目（items*.csv）+ 热帖，score-and-compose.sh 出刊 | 13 小时 / 25 小时 | 群里 @🤖 Grok Bot |
| 周报 | 同日报，score-and-compose.sh 按周出刊 | 8 天 / 9 天 | 群里 @🤖 Grok Bot |
| 热点榜 | 已归事件的稿件，score-and-compose.sh 第 4 步重算 | 13 小时 / 25 小时；0 条只提示 | 群里 @🤖 Grok Bot；上榜门槛由 C J 定 |

阈值以 check-pipeline-health.py 顶部的 FRESHNESS 表为准。

## 本机库备份
- 🤖 Grok Bot 的定时任务「AIHOT 本机库导入前备份」每天约 9:15、20:15（北京时间）跑 `/home/box/edu-hot-local/backup-local-db.sh`，在 `/home/box/edu-hot-local/backups/` 留最近 14 份 `local-*.dump`。
- 成功不发消息；失败就在「🔥 教育AIHOT」群里叫停当轮导入。
- 怎么确认它还在工作：健康检查的「本机库备份」一行，最新 local-*.dump 超过 13 小时告警，超过 25 小时 HEALTH FAIL。
- 本机库丢了：空库时跑 `/home/box/edu-hot-local/restore-from-neon.sh`，它只读 Neon；也可以从最新的 local-*.dump 恢复，方法见 /home/box/edu-hot-local/README.md。

## 红线
- 不打印任何密钥、口令、连接串；不 pkill qodercli（只杀自己的 PID）。
- 不写 /workspace/edu-radar/grok-posts.json（那是内容雷达的产物）。
- 结果只发给 C J 本人，不发心田花开群和教育AIHOT群；没有新条目且一切正常时不发消息。
