# 部署到 Vercel + Neon

默认配置按内部站处理：公开页全站 noindex，`robots.txt` 为 `Disallow: /`，响应带 `X-Robots-Tag: noindex, nofollow`。  
不想被收录以外的用途，按需改 `vercel.json` 和 `site/public/robots.txt`。

## 费用（2026 年 11 月）

- **Vercel Hobby**：个人、非商用免费。函数默认超时较短（约 10 秒），流量和构建时长有额度。适合先验证。
- **Vercel Pro**：**20 美元 / 席 / 月**。函数超时更宽（约 60 秒，可再调高），适合给团队当日常入口。
- **Neon**：有免费额度可先建库；生产流量再升套餐。选 **pooled（带 `-pooler` 主机名）** 的连接串给 Vercel。

## 架构

- **Vercel**：网页（React Router SSR）+ API（Fastify，无监听进程、无 heartbeat、无 worker watchdog）。
- **Neon Postgres**：站点数据。Vercel 上每条请求短连接（`DATABASE_POOL_MAX=1`，遇到 Neon pooler 会关闭预处理语句）。
- **一台常开的机器**：每日导入、抓取、打分、worker 在本地 Docker 跑，写本地 Postgres，再同步到 Neon（见下文）。
- `voices.json`、`content-tags.json` 通过 `site_blobs` 表同步到 Neon，Vercel 冷启动时灌进 `/tmp`。Logo 用 `apps/web/public/logos/`。

## 最少步骤

1. **登录 Vercel**（[vercel.com](https://vercel.com)），用 GitHub 账号导入你自己的仓库（本仓库的 fork），建一个项目。Framework 选 Other（仓库里已有 `vercel.json`）。Hobby 或 Pro 自选。
2. **登录 Neon**（[neon.tech](https://neon.tech)），新建一个 Postgres 项目，区域选 **新加坡**（AWS `ap-southeast-1`），与 Vercel 函数区域 `sin1` 同区。复制 **pooled** 连接串（主机名一般带 `-pooler`）。不要把完整连接串贴进聊天或提交进 git。
3. 在 Vercel 项目 **Settings → Environment Variables** 填写下面这些变量（Production，需要的话 Preview 也填）。**值只填在 Vercel 里，不要提交进仓库。**

| 变量 | 是否必填 | 说明 |
|---|---|---|
| `DATABASE_URL` | 必填 | Neon **pooled** 连接串 |
| `DATABASE_SSL` | 建议 `true` | 连 Neon 时走 SSL |
| `DATABASE_POOL_MAX` | 建议 `1` | Serverless 下每个实例 1 条连接 |
| `SITE_URL` | 必填 | 上线后的站点源，如 `https://你的项目.vercel.app`（绑定期后再改成固定域名） |
| `API_BASE_URL` | 必填 | 与 `SITE_URL` **相同**（网页服务端在同一部署里请求 API） |
| `SESSION_SECRET` | 必填 | 随机长串，至少 8 位，生产启动检查会读 |
| `IMG_PROXY_SIGN_SECRET` | 必填 | 随机长串，图片代理签名 |
| `ADMIN_PASSWORD` | 必填（或改配飞书登录） | 至少 12 位；生产环境没有后台密码或飞书登录会拒启动 |
| `TRUST_PROXY` | 建议 `true` | Vercel 在前面做反向代理 |
| `EDU_HOT_GATE_ENABLED` | 可选，默认关 | 写成 `true` 才打开应用内密码门 |
| `EDU_HOT_GATE_PASSWORD` | 开门时必填 | 访问密码，**不要打印、不要写进文档** |
| `MCP_ALLOWED_HOSTS` | 可选 | 若 MCP 还要从别的域名访问，逗号分隔主机名 |
| `AIHOT_RELEASE` | 可选 | 显示在 /api/health，便于确认新版本 |

4. 把本地库导到 Neon、跑迁移、同步目录（在运行 Docker 的机器上、填好 `DEST_DATABASE_URL` 之后执行；脚本不会打印连接串）：

```bash
# 从本地 Docker 库导出并恢复到 Neon
DEST_DATABASE_URL='（Neon 连接串，只写在环境里）' ./scripts/export-to-neon.sh

# 若导出时库还没有 0128 迁移，在目标库再跑一次
DATABASE_URL='（同一条 Neon 连接串）' npm run db:migrate

# 把 voices / content-tags 写入 site_blobs，给 Vercel 读
DATABASE_URL='（同一条 Neon 连接串）' node scripts/sync-site-blobs.ts
```

5. 在 Vercel 上触发一次部署（Import 后的首轮构建，或之后的 git 推送）。不要在准备阶段执行登录或部署。
6. 若要开密码门：在 Vercel 环境变量里设 `EDU_HOT_GATE_ENABLED=true` 和 `EDU_HOT_GATE_PASSWORD`，再部署。未设密码却开门，进程会拒绝启动。本地 Docker 不需要开这个开关。

## 上线后的每日导入

Worker 和导入脚本只要把 `DATABASE_URL` 指向 Neon，就会直接写云库。建议：

- 导入 voices / 标签之后跑 `DATABASE_URL=… node scripts/sync-site-blobs.ts`，Vercel 才能读到新目录。
- 如果本地 Docker 站仍要看同一份数据，需要让容器内 `DATABASE_URL` 也指向 Neon，或继续用本地库（两套库会分叉，需自己决定）。默认做法是：**Vercel 读 Neon，本地 Docker 仍读本地 Postgres**，由导出脚本做一次性迁移，日常增量再协商。

## 构建与入口

- 网页：`npm run build -w @aihot/web`。
- Vercel 用仓库根目录的 `api/index.ts`（API）和 `api/ssr.ts`（SSR）。`@vercel/react-router` 对 React Router 8 的官方预设若仍不兼容，不要打开，以免改掉本地 Docker 的 web 构建产物。
- 运行时需要 **Node 24**（与仓库 `engines` 一致），以便直接跑 TypeScript 源码。

## 每日导入如何同时写 Neon

日常导入只写本地 Docker Postgres（本地库是源，脚本不会改它）。导入结束后再跑一次同步即可把数据推到 Neon，供 Vercel 读取：

```bash
# 在仓库根目录；连接串放在 .secrets/neon.env（DATABASE_URL=pooled，DEST_DATABASE_URL=direct），不要打印、不要 set -x
./scripts/sync-to-neon.sh
```

`sync-to-neon.sh` 会：用 DoH 解析真实 Neon IP（应对返回假 IP 的本地 DNS）→ 把本地 Docker 库只读拷进 Neon 的 `hot_stage`，在一个短事务里与 `public` 换表（线上读不到半截数据；空的本地 `site_blobs` 不会覆盖线上目录）→ 在 direct 上跑迁移 → 把 `.data/voices.json` 和 `content-tags.json` upsert 进 `site_blobs`（`updated_at` 前进，Vercel 实例会在约 15 秒内刷新 `/tmp` 缓存）→ 按标签 `edu-hot-public` 删除生产环境的 Vercel CDN 缓存，让下一趟访问打到新数据。

公开 SSR 页面和 `GET /api/site/*` 的 CDN 策略是 `Vercel-CDN-Cache-Control: public, s-maxage=600, stale-while-revalidate=86400`，并带 `Vercel-Cache-Tag: edu-hot-public`。带 `aihot_admin` / `edu_hot_gate` 等私有 cookie、`Set-Cookie`、`/admin` 或非 GET 的请求不会进公共缓存。`X-Robots-Tag: noindex, nofollow` 仍由路由头写上。哈希静态资源 `/assets/*` 为 `public, max-age=31536000, immutable`。

### 同步后如何刷新 CDN（可靠做法）

日常同步走 **按标签删除**，不重新部署：

```bash
# 由 sync-to-neon.sh 在 upsert 之后自动调用；也可以单独跑
./scripts/purge-vercel-cdn.sh
```

脚本请求 `POST https://api.vercel.com/v1/edge-cache/dangerously-delete-by-tags`（[文档](https://vercel.com/docs/rest-api/edge-cache/dangerously-delete-by-tag)），`target=production`，标签 `edu-hot-public`。选用 delete 而不是 invalidate：invalidate 会把旧内容标成 STALE，下一请求仍可能先吐出同步前的 HTML，再在后台回源；delete 让下一请求直接 MISS 并拿到 Neon 上的新数据。每天同步一两次时，回源风暴风险可控。若 delete 接口不可用，脚本会退回到 [invalidate-by-tags](https://vercel.com/docs/rest-api/edge-cache/invalidate-by-tag)。

需要准备（不要打印、不要 `set -x`）：

```bash
# .secrets/vercel-api.env
# 在 https://vercel.com/account/tokens 建一个能访问本项目的令牌
VERCEL_TOKEN=
# 必填：项目 id；项目在团队下时再填团队 id
VERCEL_PROJECT_ID=
# VERCEL_TEAM_ID=
```

没有令牌时，脚本会提示并继续结束同步（不中断写库）。这时可以用一次新的生产部署清掉旧 CDN 缓存（新部署不会复用上一份 ISR/CDN 条目），或等待 `s-maxage=600`；注意 `stale-while-revalidate=86400` 仍可能在过期后继续送出旧正文，所以有令牌的按标签删除才是日常可靠路径。

把这条接到每轮导入之后即可。每轮 sync-to-neon.sh 会先在本地重写当天日报（可用 SKIP_DAILY_REFRESH=1 跳过），再把「数据截至」写成这一轮实际同步的北京时间。不要和仍在写库的导入同时跑。

应急整库覆盖仍可用 `export-to-neon.sh`（`pg_restore --clean`），日常同步不要走这条路径。

## 国内公司动态与国内政策

公开页：`/companies`（接口 `GET /api/site/company-updates`）、`/policies`（接口 `GET /api/site/policy-updates`）。各自列出最近 90 个北京日历日内、已核对原文或标明「未查到原文」的报道。公司栏按名单归类，默认先展示最近几条，可展开看窗口内全部条目；政策栏以补录的 `policy-backfill*.csv` 为准，按文章自己的日期倒序；与社区同题政策帖去重，优先已核对原文的补录。征求意见稿在页面标明「征求意见稿，未施行」。2026 年 4 月的全国五部门《人工智能+教育》行动计划不作为近三个月新政策。海外稿如 The 74 不会进入。这两个栏目不走精选 60 分 / 7 天门槛，也不走往期 30 天新鲜度规则，导入时 `selected = false`，不会把老条目送进首页精选。没有动态的公司写「近三个月未查到」，不拿窗口外的旧稿凑数。公开正文按 `site/public-copy.ts` 去掉站点配置的隐藏词（默认没有）。

公司名单以站点 taxonomy 的主体和别名为准，栏目当前包括：作业帮、猿辅导、学而思/好未来、新东方、有道、讯飞、高途、豆神、心田花开、斑马、叫叫、豆包爱学、松鼠Ai、读书郎、洋葱学园、步步高、希沃、学为贵、银河智学（小鹿爱学）、凯文教育、一起教育。数据来自站内已有条目的公司标签，以及补录 CSV。

### 补录导入（可重复跑，按原文链接去重）

把近 90 天的公司动态和政策分批放在同一目录，也可能写成一份合集。导入脚本会读取目录下全部 `items-backfill*.csv` 和 `policy-backfill*.csv`（含 `items-backfill-90d.csv`），按「原文链接」去重。政策类由文件名 `policy-backfill*` 或「信源类型 / 分类」识别，进入「国内政策」；「公司」列可空。有「公司」列则按 taxonomy 别名映射；没有则用标题和事实摘要按同一套别名打标签。已核对原文的条目会写入公开列表（`selected = false`）。导入不会改已在精选里的旧条目，只会补标签。

脚本依次查看这些目录（存在才读）：

1. 环境变量 `COMPANY_BACKFILL_DIR`，或参数 / `COMPANY_BACKFILL_CSV` 所在目录
2. 容器内 `/data`、`/tmp`

13 列（每日 `items.csv` 的 12 列 + 「公司」）。文件尚未到位时，已有的 `items-backfill.csv` 也会被读入；重跑同一批不会复制条目。

```bash
# 在仓库根目录，补录 CSV 放在 ./backfill/（可重复执行）：
docker cp ./backfill/. edu-hot-api-1:/tmp/backfill/
docker exec -w /app -e COMPANY_BACKFILL_DIR=/tmp/backfill edu-hot-api-1 node /app/scripts/import-company-backfill.ts

# 导入之后把容器里的 content-tags 拷回宿主机，再同步到 Neon（Vercel 读这份），并按标签清 CDN：
docker cp edu-hot-api-1:/data/content-tags.json .data/content-tags.json
./scripts/sync-to-neon.sh
```

没有匹配的补录文件时脚本会报找不到 CSV 并退出；routine 可先判断目录里是否有 `items-backfill*.csv` 或 `policy-backfill*.csv`。已在站内库里的条目由栏目按公司标签归入，不必写进补录。
