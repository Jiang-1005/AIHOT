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
   - 媒体：/workspace/ai-edu/briefs/daily-YYYY-MM-DD/ 下的约定文件（早 items.csv，晚 items-pm.csv 或别名 items-evening.csv；12 列表头）。缺文件就写明缺了，不要自己补抓芥末堆、中国教育在线、多知、EdSurge、K-12 Dive、The 74。导入用 `/workspace/edu-hot/scripts/import-brief-items.sh --date YYYY-MM-DD`（它会先把运维目录这份脚本拷进 API 容器再跑，只读上面这些约定文件名）。同目录里的 items-noon.csv、items.dedup.csv、核验清单等非正式文件只提示，不会被自动读进来；不要把它们当作 --file 传进去。
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
- 输出一行 JSON：counts 是各步数量，reports.generated 是新写或刷新的期数，hot.entries 是上榜条数，hot.candidates 是本轮参与排序的事件数（默认 heat 模式：48 小时内至少 1 个精选源；HOT_RANKING_MODE=threshold 时仍要求至少 2 个独立来源且其中 1 个精选源）。ok=false 或退出码非 0 就停下，不同步，在群里叫 Grok Bot。
- hot.entries=0 不算失败。heat 模式下表示 48 小时内没有带精选源的事件；threshold 模式下表示没有两家以上来源（且含 1 个精选源）共同报道的事件。照常同步，报告里写一句「热点榜 0 条（candidates=N，mode=…）」。
- 可重复跑；不挑内容、不改打分规则和门槛（门槛在 docs/selection.md）。
- 一天没跑会漏刊：稿子当天没打分，第二天补打分后不会自动进前一天的日报（按上线时间算窗口），需要 Grok Bot 手动补。所以早晚两轮都要跑。

## 健康检查（2026-11-17 起，每轮同步后必跑）
第 4 步 sync-to-neon.sh 跑完之后：

    python3 /workspace/edu-hot/scripts/check-pipeline-health.py

- 最后一行是 HEALTH OK 才算这轮完成；报告里加一行「健康检查：OK」，或原样贴 HEALTH FAIL 那一行。FAIL 就不报完成。
- FAIL 在 scoring / issue：先再跑一次 score-and-compose.sh 和 sync-to-neon.sh，再查一次；还 FAIL 就在群里叫 Grok Bot。
- FAIL 在 inputs：只报告清单里该有、且已过截止时间仍缺的文件（雷达早 8:25 / 晚 19:20，脚本在 8:40 / 19:35 才升为 FAIL；行业早 8:50 / 晚 19:50，脚本在 9:05 / 20:05 才升为 FAIL）。目录里多出来的、名字不合约定的雷达文件只 WARN，不算缺件，不替别的 bot 改名或补抓。行业目录里的非正式 items 文件（如 items-noon.csv、items.dedup.csv）同样只 WARN，因为 import-brief-items.ts 不会自动读它们；只有「会被读进来、且含有不在正式 items 里的条目」才升为 FAIL。
- FAIL 在 db：停，不同步，叫 Grok Bot。
- FAIL 在 deps（宿主机 node_modules 不在，盒子重启后会出现）：在 /workspace/edu-hot 跑 `npm ci` 再查。sync-to-neon.sh 和 score-and-compose.sh 开头会自动补装，npm ci 失败就退出非 0，这轮停下叫 Grok Bot。
- FAIL 在 fresh：某一项超过失败阈值没更新。热点榜：看 score-and-compose.sh 输出有没有 hot 字段、sync-to-neon.sh 有没有跑完，补跑这两条再查；热帖：查 import-voices.py 这轮跑没跑；日报、周报：再跑一次 score-and-compose.sh。还 FAIL 就在群里叫 Grok Bot。
- cdn 一组看访客真正拿到的（不带 ts、走 CDN）：/api/site/voices、/voices 的「数据截至」要等于本机这轮同步时间，/api/site/hot、/hot 的更新时间要等于源站。界线是同步后 17 分钟（s-maxage 600 秒 + SWR 300 秒 + 2 分钟余量）。
- 这轮同步清过 CDN（.data/cdn-purge.json 是 purged）：照常几秒跑完，不会多等。
- 这轮同步没清 CDN（sync-to-neon.sh 最后打了 `WARN: ... CDN cache was NOT purged`，比如没有 VERCEL_TOKEN）：健康检查会自己等，stderr 先打一行「最多再等 N 秒」，最长约 18 分钟，追上就提前结束。不要中途打断，等它出最后一行再报。追上了出一行 WARN「最近一次同步没清 CDN：没有 VERCEL_TOKEN」，照常报完成。过了 17 分钟还没追上就是 HEALTH FAIL。
- WARN 在 cdn「CDN 还没追上本轮同步」：只会出现在清过 CDN、却还没追上的少见情况，照常报，写上「CDN 最晚 HH:MM 追上」。想当场确认就跑 `python3 scripts/check-pipeline-health.py --only cdn --cdn-wait 1100`。
- FAIL 在 cdn：同步后已过 17 分钟，访客拿到的还是旧数据。不要重跑同步，不要自己部署，在群里叫 Grok Bot。
- 首页 / 不在 cdn 组里。实测（11-17 生产 3 次、预览 1 次）首页回的都是 `cache-control: no-cache`、`x-vercel-cache: MISS`，没有 CDN 缓存头，每次都回源取新数据。原因是首页 loader 用 cachedPage 把页面寿命卡在上游接口（/api/site/timeline、/api/site/facets）给的截止时间上，截止时间一过整页就降成 no-cache。首页也没有「数据截至」可以比。代码上，上游截止时间还没过时，首页可能短暂拿到 CDN 缓存头，这时最坏同样是 17 分钟内追上，和其他页一样。
- WARN 在 hot（热点榜 0 条）：默认只是提示，照常报，写上当前口径的 candidates（默认 heat：48 小时内至少 1 个精选源；`HOT_RANKING_MODE=threshold` 时才是至少 2 个独立来源且含 1 个精选源）。
- FAIL 在 hot（线上 0 条但本机已有候选）：本机按当前口径已能排出 ≥1 个候选，且已经过了「下一轮同步本应写下新榜」的时间（每天 9:30 / 20:30 后再留 30 分钟，即 10:00 / 21:00；或者本机 `site-sync.json` 已经在那个同步点之后跑过）。先看 score-and-compose.sh 的 hot 字段和 sync-to-neon.sh 有没有跑完，补跑后再查；还 FAIL 就在群里叫 Grok Bot。生产还停在上一轮空记录、下一轮还没到的合理窗口内，保持 WARN，不要当成失败。

### 新鲜度阈值（照 dbt source freshness：warn_after / error_after）
脚本顶部的 FRESHNESS 表是唯一出处，改阈值两处一起改。一天两轮的项目漏一轮告警、漏两轮失败；周报按自己的周期。

| 项 | 取值位置 | 告警 | HEALTH FAIL |
|---|---|---|---|
| 热帖 | 本机 .data/voices.json 的 generatedAt | 13 小时 | 25 小时 |
| 日报 | 本机 reports（kind=daily）max(generated_at) | 13 小时 | 25 小时 |
| 周报 | 本机 reports（kind=weekly）max(generated_at) | 8 天 | 9 天 |
| 热点榜 | 线上 /api/site/hot 的 computedAt | 13 小时 | 25 小时 |
| 本机库备份 | /home/box/edu-hot-local/backups 里最新 local-*.dump 的修改时间 | 13 小时 | 25 小时 |

热点榜 0 条默认只出一行提示（附本机按当前 `HOT_RANKING_MODE` 现算的 candidates，默认 heat，允许单来源）。若候选 ≥1，且已经过了应刷新的一轮（见上面 FAIL 在 hot），则升级为 HEALTH FAIL。`--only fresh` 只跑这一组；`--as-of` 回放时热帖和热点榜跳过。
- WARN 只是提示，照常报，不算 FAIL。

## 热点榜计分切换（2026-11-17）

默认 `HOT_RANKING_MODE=heat`：按独立精选源数量为主、互动取对数、HN 式衰减（窗口仍 48 小时、半衰期 24 小时）排序，单来源也可以上榜，页面标「1 个来源」。旧门槛（至少 2 个独立来源且至少 1 个精选源）可用 `HOT_RANKING_MODE=threshold` 一键切回，规则版本分别是 `heat-v2-hn-score-48h` 和 `heat-v2-threshold-48h`。

本机 API 容器改模式：在本机栈环境里设置或取消 `HOT_RANKING_MODE`，重启 api 容器（不要开 worker），再跑 `score-and-compose.sh`。不要把连接串写进命令或日志。改的是本机计算结果；不同步 Neon，线上接口不会变。

页面上：`computedAt` 超过一轮（13 小时）就去掉「实时热度」，页头改成带北京时间的过期提示。空列表要分清「已过期/正在重算」和「本轮没有多源事件」。健康检查的 13 小时告警 / 25 小时失败阈值不变。

## 对外输出谁负责
总负责：🤖 Grok Bot。导入、打分出刊、同步、健康检查由 📥 教育AIHOT 导入员每天 9:30 / 20:30 跑；脚本和热点榜重算由 Grok Bot 维护。
出问题：导入员在「🔥 教育AIHOT」群里 @🤖 Grok Bot。上榜门槛、信源、新设计上线由 C J 定。

| 输出 | 数据从哪来 | 新鲜度阈值（告警 / FAIL） | 出问题叫谁 |
|---|---|---|---|
| 热帖 | 📡 AI 教育内容雷达（grok-posts.json、x-posts-feishu-new-*.csv）+ collect-cn-community.py | 13 小时 / 25 小时 | 群里 @🤖 Grok Bot；信源由 C J 定 |
| 日报 | 🔭 AI 教培行业观察的公司、政策、媒体条目（约定的 items.csv / items-pm.csv，别名 items-evening.csv）+ 热帖，score-and-compose.sh 出刊 | 13 小时 / 25 小时 | 群里 @🤖 Grok Bot |
| 周报 | 同日报，score-and-compose.sh 按周出刊 | 8 天 / 9 天 | 群里 @🤖 Grok Bot |
| 热点榜 | 已归事件的稿件，score-and-compose.sh 第 4 步重算 | 13 小时 / 25 小时；0 条默认提示，候选≥1 且过了一轮该刷新的同步则失败 | 群里 @🤖 Grok Bot；上榜门槛由 C J 定 |

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
