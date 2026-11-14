# 精选打分、核验与第一批导出

默认模型已改走官方 DeepSeek（OpenAI 兼容）：

- `LLM_BASE_URL=https://api.deepseek.com/v1`
- `LLM_MODEL=deepseek-chat`
- `LLM_API_KEY` 与 `DEEPSEEK_API_KEY` 同用官方密钥（不要把密钥写进这个说明）

把 `DEEPSEEK_API_KEY` 写入 `/workspace/edu-hot/.env` 后，用下面这一行重启 api 和 worker（Docker API 在 `tcp://127.0.0.1:2375`）：

```bash
cd /workspace/edu-hot && DOCKER_HOST=tcp://127.0.0.1:2375 docker compose up -d --force-recreate --no-deps api worker
```

若文章因旧的 OpenRouter 额度错误还停在重试，再跑：

```bash
DOCKER_HOST=tcp://127.0.0.1:2375 docker cp scripts/requeue-waiting.ts xintian-edu-hot-api-1:/app/scripts/requeue-waiting.ts
DOCKER_HOST=tcp://127.0.0.1:2375 docker exec -w /app xintian-edu-hot-api-1 node /app/scripts/requeue-waiting.ts
```

评分完成后做第二轮四项核验（摘要对原文、链接 HTTP 200、评分理由、与心田关系），未全部通过的会用编辑覆盖取消精选，并导出 CSV：

```bash
DOCKER_HOST=tcp://127.0.0.1:2375 docker cp scripts/verify-featured.ts xintian-edu-hot-api-1:/app/scripts/verify-featured.ts
DOCKER_HOST=tcp://127.0.0.1:2375 docker cp /workspace/research/zhixin/selected_all.csv xintian-edu-hot-api-1:/data/zhixin-selected_all.csv
DOCKER_HOST=tcp://127.0.0.1:2375 docker exec -w /app \
  -e ZHIXIN_CSV=/data/zhixin-selected_all.csv \
  -e FEATURED_CSV=/data/featured-batch1.csv \
  xintian-edu-hot-api-1 node /app/scripts/verify-featured.ts --apply
DOCKER_HOST=tcp://127.0.0.1:2375 docker cp xintian-edu-hot-api-1:/data/featured-batch1.csv /workspace/edu-hot/featured-batch1.csv
```

可定时在每天采集、分析结束约 15 分钟后跑同一条核验命令；脚本可重复执行。

备用模型（需 `OPENROUTER_API_KEY`，且下次重建镜像后才会出现在后台预设里）：`openrouter-deepseek-flash`（`deepseek/deepseek-v4.1-flash`）。

精选门槛是 `industry/selection.ts` 里的 `SELECTION.threshold`（现在是 60，所有信源共用，不再按 T1/T2 分档）。首页精选窗口是 `featuredMaxAgeDays`（现在是 7），往期窗口是 `archiveMaxAgeDays`（现在是 30），都按稿件 dateline 的北京日历日（含边界）。往期页在 `/archive`。改这些常数后把 `industry/selection.ts` 和 `packages/backend/src/publication/publish.ts` 拷进 api/worker 容器并重启 worker，再跑：

```bash
DOCKER_HOST=tcp://127.0.0.1:2375 docker cp scripts/republish-selected.ts xintian-edu-hot-api-1:/app/scripts/republish-selected.ts
DOCKER_HOST=tcp://127.0.0.1:2375 docker exec -w /app xintian-edu-hot-api-1 node /app/scripts/republish-selected.ts
```
