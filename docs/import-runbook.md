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

## 红线
- 不打印任何密钥、口令、连接串；不 pkill qodercli（只杀自己的 PID）。
- 不写 /workspace/edu-radar/grok-posts.json（那是内容雷达的产物）。
- 结果只发给 C J 本人，不发心田花开群和教育AIHOT群；没有新条目且一切正常时不发消息。
