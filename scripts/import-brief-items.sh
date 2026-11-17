#!/usr/bin/env bash
# 把约定的行业 items 导入本机 API 容器。先把运维目录这份脚本拷进容器，再执行，
# 这样 9:30 / 20:30 用的是 /workspace/edu-hot 上的代码，而不是镜像里可能过期的副本。
# 只传 --date 时，把宿主机 briefs 目录里的正式文件拷进容器再交给脚本；
# 正式文件是 items.csv / items-pm.csv / items-evening.csv（以及容器内已有的
# /data/brief-YYYYMMDD-items.csv）。items-noon.csv、items.dedup.csv 等不会被拷进去，也不会被自动发现。
set -euo pipefail
export DOCKER_HOST="${DOCKER_HOST:-tcp://127.0.0.1:2375}"
C=xintian-edu-hot-api-1
DIR="$(cd "$(dirname "$0")" && pwd)"
docker cp "$DIR/import-brief-items.ts" "$C:/app/scripts/import-brief-items.ts"

date_arg=""
has_explicit_file=0
args=("$@")
i=0
while [[ $i -lt ${#args[@]} ]]; do
  a="${args[$i]}"
  if [[ "$a" == "--date" || "$a" == "-d" ]]; then
    i=$((i + 1))
    date_arg="${args[$i]:-}"
  elif [[ "$a" == --date=* ]]; then
    date_arg="${a#--date=}"
  elif [[ "$a" == "--file" || "$a" == "-f" ]]; then
    has_explicit_file=1
    i=$((i + 1))
  elif [[ "$a" == --file=* || "$a" == --help || "$a" == "-h" ]]; then
    if [[ "$a" == --file=* ]]; then
      has_explicit_file=1
    fi
  elif [[ "$a" == -* ]]; then
    :
  else
    has_explicit_file=1
  fi
  i=$((i + 1))
done

if [[ " $* " == *" --help "* || " $* " == *" -h "* ]]; then
  docker exec -w /app "$C" node /app/scripts/import-brief-items.ts "$@"
  exit $?
fi

if [[ "$has_explicit_file" -eq 1 ]]; then
  docker exec -w /app "$C" node /app/scripts/import-brief-items.ts "$@"
  exit $?
fi

if [[ -z "$date_arg" ]]; then
  date_arg="$(date +%Y-%m-%d)"
fi
if [[ ! "$date_arg" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
  echo "invalid date $date_arg; expected YYYY-MM-DD" >&2
  exit 1
fi

host_dir="/workspace/ai-edu/briefs/daily-${date_arg}"
dest="/tmp/brief-items-${date_arg}"
copied=()
docker exec "$C" mkdir -p "$dest"
for name in items.csv items-pm.csv items-evening.csv; do
  if [[ -f "${host_dir}/${name}" ]]; then
    docker cp "${host_dir}/${name}" "$C:${dest}/${name}"
    copied+=("${dest}/${name}")
  fi
done

if [[ ${#copied[@]} -gt 0 ]]; then
  docker exec -w /app "$C" node /app/scripts/import-brief-items.ts --date "$date_arg" "${copied[@]}"
else
  docker exec -w /app "$C" node /app/scripts/import-brief-items.ts --date "$date_arg"
fi
