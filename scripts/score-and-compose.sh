#!/usr/bin/env bash
# 打分 + 出刊（worker 关着时用）：给还没打分的稿子打分、归事件、写当天和缺的日报/周报/月报。
# 导入完、sync-to-neon.sh 之前跑一次；可重复跑。会调用模型（DeepSeek）。
set -euo pipefail
export DOCKER_HOST="${DOCKER_HOST:-tcp://127.0.0.1:2375}"
C=xintian-edu-hot-api-1
docker cp "$(dirname "$0")/score-and-compose.ts" "$C:/app/scripts/score-and-compose.ts"
docker exec -w /app "$C" node /app/scripts/score-and-compose.ts 2>&1 | grep -v '"queue drain"'
