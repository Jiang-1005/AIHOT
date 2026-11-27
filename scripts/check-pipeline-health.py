#!/usr/bin/env python3
"""教育AIHOT 端到端健康检查（只读）。

导入员每轮在 sync-to-neon.sh 之后跑一次；任何 bot 动过本机栈（重启、恢复、换分支）后也跑一次。
它不看「脚本跑没跑」，只看结果对不对：
  inputs   清单里的输入文件按时到位（热帖 Notion 快照与导入戳记，行业 daily-YYYY-MM-DD/items.csv|items-pm.csv）。
           x-posts-feishu-new-*.csv 只提示，不再作为热帖导入门。清单外的文件名只提示，不算缺件
  db       本机库在、不空
  scoring  导进来的稿子 3 小时内打完分（worker 关着时靠 score-and-compose.sh）
  issue    最新日报不早于昨天（有新稿却没出刊 = 失败）
  worker   worker 心跳（关着是已知状态，只提示）
  live     线上最新日报 = 本机最新日报，线上「数据截至」不落后本机同步时间（带 ts，绕过 CDN，看的是源站）
  cdn      访客真正拿到的（不带 ts，走 CDN）：/api/site/voices、/voices 的「数据截至」= 本机同步时间，
           /api/site/hot、/hot 的 computedAt = 源站。同步后 s-maxage+SWR+余量（17 分钟）内没对上 = PEND（不长等，
           给出「复查时间 HH:MM」，最后一行 HEALTH PENDING、退出码 2），过了还没对上 = FAIL。
           上一轮同步没清 CDN（.data/cdn-purge.json 不是 purged，比如没有 VERCEL_TOKEN）时另出一行 WARN。
           到复查时间后跑 --only cdn 只会出 OK 或 FAIL；--wait-for-cdn 会自己等到复查时间（最长约 17.5 分钟，
           每 60 秒往 stderr 打一行进度），超过前台 13 分钟上限，只能放后台跑（见 docs/import-runbook.md）。
           首页 / 不查：它没有「数据截至」可比，而且实测是 no-cache、CDN 不缓存（见 docs/import-runbook.md）
  fresh    热帖、日报、周报、热点榜、本机库备份各自多久没更新，阈值见下面的 FRESHNESS 表；热点榜 0 条默认提示，附当前口径的 candidates；若候选≥1 且已过应刷新的一轮则升级为失败
  deps     宿主机 node_modules/@aihot/backend 在（sync-to-neon.sh 跑 migrate.ts 要用）
  checkout 运维目录 /workspace/edu-hot 没缺主线 jiang/main 上的运维脚本，本分支的运维脚本也已进主线

全部只读：docker exec psql SELECT、读文件、curl 公网只读接口、git 本地对象。不写库、不 push、不打印任何密钥。
退出码：0 = HEALTH OK（可能有 WARN）；1 = HEALTH FAIL；2 = HEALTH PENDING（CDN 还在 17 分钟界线内没追上，
到复查时间再跑 --only cdn）。最后一行总是 HEALTH OK / HEALTH FAIL / HEALTH PENDING 之一。

  python3 scripts/check-pipeline-health.py                 # 现在
  python3 scripts/check-pipeline-health.py --slot am       # 指定早轮/晚轮（默认按时间：<15:00 为 am）
  python3 scripts/check-pipeline-health.py --as-of 2026-11-17T09:45:00+08:00   # 回放：只用当时已存在的数据（live 自动跳过）
  python3 scripts/check-pipeline-health.py --only inputs   # 只校验输入文件（给雷达、行业观察写完文件后自查）
  python3 scripts/check-pipeline-health.py --only cdn      # 复查时间到了以后复查 CDN：只出 OK / FAIL
  python3 scripts/check-pipeline-health.py --only cdn --wait-for-cdn   # 等到复查时间再判（最长约 17.5 分钟，只能后台跑）
"""
import argparse, csv, datetime as dt, glob, json, os, re, subprocess, sys, urllib.request

TZ = dt.timezone(dt.timedelta(hours=8))
RADAR_DIR = "/workspace/edu-radar"
BRIEFS = "/workspace/ai-edu/briefs"
REPO = "/workspace/edu-hot"
SITE = "https://edu-ai-hot.vercel.app"
DB = os.environ.get("EDUHOT_DB_CONTAINER", "xintian-edu-hot-db-1")
SCORE_SLA_H = 3
# 新鲜度阈值（照 dbt source freshness：每项一个 warn_after / error_after，超过 error_after = HEALTH FAIL）。
# 一天两轮（9:30 / 20:30）的项目：13 小时告警、25 小时失败（漏一轮告警，漏两轮失败）。周报按自己的周期：8 天告警、9 天失败。
# 改阈值只改这张表，docs/import-runbook.md「健康检查」一节的同名表要一起改。
#   key       名称      取值位置                                        warn_h  fail_h
FRESHNESS = [
    ("voices", "热帖",   "本机 .data/voices.json 的 generatedAt",       13,     25),
    ("daily",  "日报",   "本机 reports（kind=daily）max(generated_at)",  13,     25),
    ("weekly", "周报",   "本机 reports（kind=weekly）max(generated_at)", 8 * 24, 9 * 24),
    ("hot",    "热点榜", "线上 /api/site/hot 的 computedAt",             13,     25),
    ("backup", "本机库备份", "/home/box/edu-hot-local/backups 里最新 local-*.dump 的修改时间", 13, 25),
]
BACKUP_DIR = "/home/box/edu-hot-local/backups"
OPS_SCRIPTS = ["scripts/sync-to-neon.sh", "scripts/export-to-neon.sh", "scripts/resolve-neon-urls.py",
               "scripts/reset-sequences.sql", "scripts/env-exports.py", "scripts/import-voices.py",
               "scripts/notion-hotposts-snapshot.py", "scripts/scrub-xhs.py",
               "scripts/import-brief-items.ts", "scripts/import-brief-items.sh", "scripts/score-and-compose.sh", "scripts/score-and-compose.ts",
               "scripts/check-pipeline-health.py", "docs/import-runbook.md", "docs/notion-hotposts.md"]

results = []  # (level, check, message)
def add(level, check, msg): results.append((level, check, msg))

def psql(sql):
    env = dict(os.environ, DOCKER_HOST=os.environ.get("DOCKER_HOST", "tcp://127.0.0.1:2375"))
    p = subprocess.run(["docker", "exec", DB, "psql", "-U", "aihot", "-d", "aihot", "-At", "-F", "|",
                        "-v", "ON_ERROR_STOP=1", "-c", sql], capture_output=True, text=True, env=env, timeout=60)
    if p.returncode != 0:
        raise RuntimeError((p.stderr or p.stdout).strip().splitlines()[-1] if (p.stderr or p.stdout).strip() else "psql failed")
    return [l.split("|") for l in p.stdout.strip().splitlines() if l]

def existed(path, as_of):
    return os.path.exists(path) and dt.datetime.fromtimestamp(os.path.getmtime(path), TZ) <= as_of

# ---------- inputs ----------
def check_notion_hotposts(as_of, slot, snapshot, stamp):
    """热帖导入门：完整快照 + 与快照哈希一致的 ok 戳记。文件不存在时跟雷达同一截止时间。"""
    script_dir = os.path.dirname(os.path.abspath(__file__))
    if script_dir not in sys.path:
        sys.path.insert(0, script_dir)
    import notion_hotposts
    due = slot_due(as_of, slot, "radar")
    if not existed(snapshot, as_of):
        add("FAIL" if due else "WARN", "inputs", f"热帖快照 {os.path.basename(snapshot)} 还没到")
        return
    try:
        snap = notion_hotposts.load_snapshot(snapshot)
    except notion_hotposts.GateError as exc:
        add("FAIL", "inputs", f"热帖快照不完整或哈希不符：{exc}")
        return
    add("OK", "inputs", f"热帖快照 {snap['integrity']['rows_sha256'][:12]} 完整，{snap['pagination']['row_count']} 条")
    if not existed(stamp, as_of):
        add("FAIL" if due else "WARN", "inputs", "热帖导入戳记还没到，不能进入同步")
        return
    try:
        notion_hotposts.assert_sync_allowed(snapshot, stamp)
    except notion_hotposts.GateError as exc:
        add("FAIL", "inputs", f"热帖导入戳记未通过，不能进入同步：{exc}")
        return
    add("OK", "inputs", "热帖导入戳记与快照哈希一致")


def check_inputs(as_of, slot, radar_dir=None, briefs=None, hotposts_snapshot=None, hotposts_stamp=None):
    # 热帖权威是 Notion 快照。旧的 x-posts-feishu-new-*.csv 在也不算到齐，不在也不算缺件。
    radar_dir = radar_dir or RADAR_DIR
    briefs = briefs or BRIEFS
    day = as_of.date(); iso = day.isoformat()
    if hotposts_snapshot:
        check_notion_hotposts(as_of, slot, hotposts_snapshot, hotposts_stamp or "")
    legacy = [os.path.basename(p) for p in glob.glob(f"{radar_dir}/x-posts-feishu-new-*.csv") if existed(p, as_of)]
    for name in legacy:
        add("WARN", "inputs", f"雷达 {name} 是旧飞书清单，热帖导入已不读它")
    ddir = f"{briefs}/daily-{iso}"
    canon = f"{ddir}/{'items.csv' if slot == 'am' else 'items-pm.csv'}"
    if existed(canon, as_of):
        add("OK", "inputs", f"行业 daily-{iso}/{os.path.basename(canon)} 在")
    else:
        alias = f"{ddir}/items-evening.csv"
        if slot == "pm" and existed(alias, as_of):
            add("WARN", "inputs", f"行业晚轮用了别名 items-evening.csv，约定是 items-pm.csv")
        else:
            add("FAIL" if slot_due(as_of, slot, "industry") else "WARN", "inputs", f"行业 daily-{iso}/{os.path.basename(canon)} 还没到")
    # import-brief-items.ts 自动发现只读约定文件名；清单外的 items*.csv 不会被读进来。
    if os.path.isdir(ddir):
        canon_urls = set()
        for n in OFFICIAL_ITEMS_NAMES:
            canon_urls |= urls_of(f"{ddir}/{n}", "原文链接")
        for p in sorted(glob.glob(f"{ddir}/items*.csv")):
            n = os.path.basename(p)
            if n in OFFICIAL_ITEMS_NAMES or not existed(p, as_of):
                continue
            extra = urls_of(p, "原文链接") - canon_urls if has_col(p, "原文链接") else set()
            level, msg = assess_extra_items_file(n, extra_count=len(extra), will_read=importer_auto_reads_items(n), has_url_col=has_col(p, "原文链接"))
            add(level, "inputs", msg)

# Keep in sync with OFFICIAL_BRIEF_ITEM_FILES in scripts/import-brief-items.ts
OFFICIAL_ITEMS_NAMES = ("items.csv", "items-pm.csv", "items-evening.csv")

def importer_auto_reads_items(name):
    return name in OFFICIAL_ITEMS_NAMES

def assess_extra_items_file(name, extra_count, will_read, has_url_col=True):
    """Informal items files are WARN once the importer will not read them.
    FAIL is reserved for a file that would be imported and has unofficial URLs."""
    if will_read and has_url_col and extra_count:
        return "FAIL", f"{name} 会被 import-brief-items.ts 一起读进来，且有 {extra_count} 条不在正式 items 里（候选/删掉的条目会上站）"
    if will_read and not has_url_col:
        return "WARN", f"{name} 会被 import-brief-items.ts 读进来，但没有「原文链接」列，导入会整份跳过"
    if not has_url_col:
        return "WARN", f"{name} 不是约定的正式 items 文件，且没有「原文链接」列；import-brief-items.ts 不会读进来"
    if extra_count:
        return "WARN", f"{name} 不是约定的正式 items 文件，其中有 {extra_count} 条不在正式 items 里；import-brief-items.ts 不会读进来"
    return "WARN", f"{name} 不是约定的正式 items 文件；import-brief-items.ts 不会读进来"

def has_col(path, col):

    try:
        with open(path, encoding="utf-8-sig") as f:
            return col in (next(csv.reader(f), []) or [])
    except Exception:
        return False

def urls_of(path, col):
    if not os.path.exists(path):
        return set()
    try:
        with open(path, encoding="utf-8-sig") as f:
            return {(r.get(col) or "").strip() for r in csv.DictReader(f)} - {""}
    except Exception:
        return set()

def slot_due(as_of, slot, who):
    # 雷达早 8:25 / 晚 19:20，行业早 8:50 / 晚 19:50；过了这个点还没有才算失败
    due = {("radar", "am"): (8, 40), ("radar", "pm"): (19, 35), ("industry", "am"): (9, 5), ("industry", "pm"): (20, 5)}[(who, slot)]
    return (as_of.hour, as_of.minute) >= due

# ---------- db / scoring / issue / worker ----------
def check_db(as_of):
    ts = as_of.isoformat()
    try:
        n = int(psql(f"SELECT count(*) FROM articles WHERE created_at <= '{ts}'")[0][0])
    except Exception as e:
        add("FAIL", "db", f"本机库读不到：{e}（先 /home/box/edu-hot-local/start-local-stack.sh，别拿空库同步）")
        return False
    if n == 0:
        add("FAIL", "db", "本机库是空的，停：不要 sync-to-neon（会把线上覆盖成空）")
        return False
    add("OK", "db", f"本机库 articles {n} 条")
    rows = psql(f"""
      SELECT (a.created_at AT TIME ZONE 'Asia/Shanghai')::date, count(*),
             to_char(min(a.created_at) AT TIME ZONE 'Asia/Shanghai','MM-DD HH24:MI')
      FROM articles a
      WHERE a.created_at <= timestamptz '{ts}' - interval '{SCORE_SLA_H} hours'
        AND a.created_at > timestamptz '{ts}' - interval '10 days'
        AND NOT EXISTS (SELECT 1 FROM analyses x WHERE x.article_id = a.id AND x.created_at <= '{ts}')
        AND a.processing_state IN ('new','analyzed','blocked')
      GROUP BY 1 ORDER BY 1""")
    unscored = sum(int(r[1]) for r in rows)
    if unscored:
        detail = "，".join(f"{r[0][5:]} {r[1]} 条" for r in rows)
        add("FAIL", "scoring", f"{unscored} 条稿子导入超过 {SCORE_SLA_H} 小时还没打分（{detail}，最早 {rows[0][2]}）→ 跑 scripts/score-and-compose.sh")
    else:
        add("OK", "scoring", f"没有超过 {SCORE_SLA_H} 小时未打分的稿子")
    last_score = psql(f"SELECT to_char(max(created_at) AT TIME ZONE 'Asia/Shanghai','MM-DD HH24:MI') FROM analyses WHERE created_at <= '{ts}'")[0][0]
    latest = psql(f"SELECT max(key) FROM reports WHERE kind='daily' AND generated_at <= '{ts}'")[0][0]
    yday = (as_of.date() - dt.timedelta(days=1)).isoformat()
    if not latest:
        add("FAIL", "issue", "本机一期日报都没有")
    elif latest >= yday:
        add("OK", "issue", f"本机最新日报 {latest}（最后打分 {last_score}）")
    else:
        newer = int(psql(f"SELECT count(*) FROM articles WHERE created_at <= '{ts}' AND (created_at AT TIME ZONE 'Asia/Shanghai')::date > date '{latest}'")[0][0])
        if newer:
            add("FAIL", "issue", f"本机最新日报停在 {latest}，之后已导入 {newer} 条稿子却没出刊（最后打分 {last_score}）→ 跑 scripts/score-and-compose.sh")
        else:
            add("WARN", "issue", f"本机最新日报 {latest}，之后没有新稿，没出刊属正常")
    hb = psql(f"SELECT to_char(max(finished_at) AT TIME ZONE 'Asia/Shanghai','MM-DD HH24:MI'), extract(epoch from (timestamptz '{ts}' - max(finished_at)))/3600 FROM job_runs WHERE finished_at <= '{ts}'")[0]
    if hb[0] and float(hb[1]) > 2:
        add("WARN", "worker", f"worker 最后一次心跳 {hb[0]}（{float(hb[1]):.0f} 小时前）；关着是已知状态，打分出刊必须靠 score-and-compose.sh")
    elif hb[0]:
        add("OK", "worker", f"worker 心跳 {hb[0]}")
    return latest

# ---------- live ----------
def get_json(path):
    """源站视角：带 ts 参数，CDN 必然 MISS。"""
    req = urllib.request.Request(f"{SITE}{path}{'&' if '?' in path else '?'}ts={int(dt.datetime.now().timestamp())}",
                                 headers={"User-Agent": "eduhot-health/1"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r)

def check_live(local_latest):
    try:
        items = get_json("/api/site/reports/daily").get("items") or []
        live_latest = max((i.get("key") for i in items if i.get("key")), default=None)
        live_issue = next((i.get("issueNumber") for i in items if i.get("key") == live_latest), None)
    except Exception as e:
        add("FAIL", "live", f"线上日报接口读不到：{e}"); return
    if local_latest and live_latest != local_latest:
        add("FAIL", "live", f"线上最新日报 {live_latest}，本机是 {local_latest} → 还没同步，或 CDN 未刷新（等 10 分钟再查）")
    else:
        add("OK", "live", f"线上最新日报 {live_latest}（第 {live_issue} 期）")
    try:
        as_of_txt = get_json("/api/site/voices").get("dataAsOf", "")
        sync = json.load(open(f"{REPO}/.data/site-sync.json")).get("syncedAt", "")
        m = re.search(r"(\d+) 月 (\d+) 日 (\d+):(\d+)", as_of_txt)
        if m and sync:
            live_t = dt.datetime(int(sync[:4]), int(m[1]), int(m[2]), int(m[3]), int(m[4]), tzinfo=TZ)
            loc_t = dt.datetime.strptime(sync, "%Y-%m-%d %H:%M").replace(tzinfo=TZ)
            lag = (loc_t - live_t).total_seconds() / 60
            add("WARN" if lag > 15 else "OK", "live", f"线上数据截至 {as_of_txt}，本机最近同步 {sync}" + ("（线上落后，CDN 未刷新或同步没成功）" if lag > 15 else ""))
    except Exception as e:
        add("WARN", "live", f"数据截至没核上：{e}")

# ---------- cdn（不带 ts：访客真正看到的） ----------
# 和 packages/contracts/src/public-cache.ts 的 PUBLIC_CDN_S_MAXAGE / PUBLIC_CDN_SWR 保持一致。
CDN_S_MAXAGE = 600
CDN_SWR = 300
CDN_MARGIN = 120
CDN_DEADLINE = dt.timedelta(seconds=CDN_S_MAXAGE + CDN_SWR + CDN_MARGIN)
CDN_PURGE_FILE = f"{REPO}/.data/cdn-purge.json"

def get_public(path):
    """访客视角：不带 ts，可能是 CDN HIT/STALE。返回 (正文, x-vercel-cache, age)。"""
    req = urllib.request.Request(f"{SITE}{path}", headers={"User-Agent": "eduhot-health/1", "Accept": "application/json, text/html"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read().decode("utf-8", "replace"), r.headers.get("x-vercel-cache") or "-", r.headers.get("age") or "-"

def parse_as_of(text, year):
    """「11 月 17 日 20:44」或「11月17日 20:42」→ 北京时间分钟。"""
    m = re.search(r"(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(\d{1,2}):(\d{2})", text or "")
    return dt.datetime(year, int(m[1]), int(m[2]), int(m[3]), int(m[4]), tzinfo=TZ) if m else None

def iso_minute(iso):
    return dt.datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(TZ).replace(second=0, microsecond=0)

def read_sync_iso():
    raw = json.load(open(f"{REPO}/.data/site-sync.json"))
    if raw.get("syncedAtIso"): return dt.datetime.fromisoformat(raw["syncedAtIso"]).astimezone(TZ)
    return dt.datetime.strptime(raw["syncedAt"], "%Y-%m-%d %H:%M").replace(tzinfo=TZ)

def cdn_probes(sync_min, origin_hot_min):
    """每个不带 ts 的地址：(名称, 线上值, 应当值, cache 状态)。线上值 None = 没解析出来。"""
    out = []
    body, cache, age = get_public("/api/site/voices")
    out.append(("/api/site/voices 数据截至", parse_as_of(json.loads(body).get("dataAsOf", ""), sync_min.year), sync_min, f"{cache}/age {age}"))
    body, cache, age = get_public("/voices")
    m = re.search(r"数据截至\s*([^<\"]{0,40})", body)
    out.append(("/voices 数据截至", parse_as_of(m[1] if m else "", sync_min.year), sync_min, f"{cache}/age {age}"))
    body, cache, age = get_public("/api/site/hot")
    ca = json.loads(body).get("computedAt")
    out.append(("/api/site/hot computedAt", iso_minute(ca) if ca else None, origin_hot_min, f"{cache}/age {age}"))
    body, cache, age = get_public("/hot")
    m = re.search(r"(\d{1,2}月\d{1,2}日 \d{1,2}:\d{2}) 更新", body)
    out.append(("/hot 更新时间", parse_as_of(m[1] if m else "", sync_min.year), origin_hot_min, f"{cache}/age {age}"))
    return out

def unpurged_reason(purge, sync_at):
    """这一轮同步没清 CDN 的原因；清过了、或记录属于更早的同步，返回 None。"""
    if not purge or purge.get("status") == "purged":
        return None
    try: purge_at = dt.datetime.fromisoformat(purge.get("at", "")).astimezone(TZ)
    except Exception: purge_at = None
    if purge_at is not None and purge_at < sync_at - dt.timedelta(minutes=5):
        return None
    return "没有 VERCEL_TOKEN" if purge.get("status") == "no-token" else f"清缓存接口失败（exit {purge.get('exitCode')}）"

def recheck_at(sync_at):
    """CDN 的判定时间：同步后 17 分钟界线再加 30 秒，取整到下一分钟。过了这个点还旧 = FAIL。"""
    t = sync_at + CDN_DEADLINE + dt.timedelta(seconds=30)
    return t.replace(second=0, microsecond=0) + (dt.timedelta(minutes=1) if (t.second or t.microsecond) else dt.timedelta(0))

RECHECK_CMD = "python3 /workspace/edu-hot/scripts/check-pipeline-health.py --only cdn"

def assess_cdn(probes, sync_at, now, purge=None):
    """纯函数，方便测：返回 [(level, msg)]。level 里的 PEND = 还在 17 分钟界线内没追上，要到复查时间再判。"""
    res = []
    behind = [p for p in probes if p[1] is None or p[1] < p[2]]
    ahead = [p for p in probes if p[1] is not None and p[1] > p[2]]
    deadline = sync_at + CDN_DEADLINE
    when = recheck_at(sync_at)
    why = unpurged_reason(purge, sync_at)
    if why:
        res.append(("WARN", f"最近一次同步没清 CDN：{why}；线上最晚 {deadline:%H:%M} 才会追上"))
    if not behind:
        res.append(("OK", "不带 ts 的线上地址都已是本轮数据：" + "；".join(f"{n} {v:%m-%d %H:%M}（{c}）" for n, v, _, c in probes)))
    else:
        detail = "；".join(f"{n} {'读不到' if v is None else f'{v:%m-%d %H:%M}'}，应为 {want:%m-%d %H:%M}（{c}）" for n, v, want, c in behind)
        if now <= deadline:
            res.append(("PEND", f"CDN 还没追上本轮同步，复查时间 {when:%H:%M}：到时跑 {RECHECK_CMD}，那一次还旧就是 FAIL（{detail}）"))
        else:
            res.append(("FAIL", f"CDN 旧缓存：同步 {sync_at:%H:%M} 后已过 {int((now - sync_at).total_seconds() // 60)} 分钟，访客还拿到旧数据（{detail}）"))
    for n, v, want, c in ahead:
        res.append(("WARN", f"{n} {v:%m-%d %H:%M} 比本机同步/源站 {want:%m-%d %H:%M} 还新：本机 .data/site-sync.json 可能不是最近一次同步写的"))
    return res

def check_cdn(wait=False, retries=2, pause_s=20, progress_s=60, now=None, sleep=None):
    """默认不长等：没追上先隔 20 秒重问两次（SWR 回源），还在界线内就记 PEND 并给出复查时间。
    wait=True（--wait-for-cdn）：没追上就一直等到复查时间再判，结果只会是 OK 或 FAIL，期间每 60 秒往 stderr 打一行进度。"""
    import time
    now = now or (lambda: dt.datetime.now(TZ)); sleep = sleep or time.sleep
    try:
        sync_at = read_sync_iso()
    except Exception as e:
        add("WARN", "cdn", f"本机 .data/site-sync.json 读不到，跳过 CDN 核对：{e}"); return
    sync_min = sync_at.replace(second=0, microsecond=0)
    try: purge = json.load(open(CDN_PURGE_FILE))
    except Exception: purge = None
    until = recheck_at(sync_at) if wait else now()
    attempt = 0
    while True:
        try:
            origin_hot = get_json("/api/site/hot").get("computedAt")
            origin_hot_min = iso_minute(origin_hot) if origin_hot else sync_min
            probes = cdn_probes(sync_min, origin_hot_min)
        except Exception as e:
            add("FAIL", "cdn", f"不带 ts 的线上地址读不到：{e}"); return
        verdict = assess_cdn(probes, sync_at, now(), purge)
        behind = any(lv in ("PEND", "FAIL") for lv, _ in verdict)
        attempt += 1
        left = (until - now()).total_seconds()
        if not behind or (attempt > retries and left <= 0):
            break
        if attempt > retries:
            print(f"cdn: {now():%H:%M:%S} 线上还没追上本轮同步，等到 {until:%H:%M} 再判（还剩约 {int(left)} 秒）", file=sys.stderr, flush=True)
            sleep(max(1, min(progress_s, left)))
        else:
            sleep(pause_s)
    for lv, m in verdict: add(lv, "cdn", m)

def fresh_at(key, as_of, replay):
    """(每项最近一次更新的时间, 热点榜条数)；时间 None = 当时还没有数据，"SKIP" = 回放时没法查。"""
    if key == "voices":
        t = dt.datetime.strptime(json.load(open(f"{REPO}/.data/voices.json"))["generatedAt"], "%Y-%m-%d %H:%M").replace(tzinfo=TZ)
        return ("SKIP" if t > as_of else t), None
    if key in ("daily", "weekly"):
        v = psql(f"SELECT to_char(max(generated_at) AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD HH24:MI') FROM reports WHERE kind='{key}' AND generated_at <= '{as_of.isoformat()}'")
        v = v[0][0] if v else None
        return (dt.datetime.strptime(v, "%Y-%m-%d %H:%M").replace(tzinfo=TZ) if v else None), None
    if key == "hot":
        if replay: return "SKIP", None
        hot = get_json("/api/site/hot")
        return dt.datetime.fromisoformat(hot["computedAt"].replace("Z", "+00:00")).astimezone(TZ), len(hot.get("entries") or [])
    if key == "backup":
        times = [dt.datetime.fromtimestamp(os.path.getmtime(f), TZ) for f in glob.glob(f"{BACKUP_DIR}/local-*.dump")]
        times = [t for t in times if t <= as_of]
        return (max(times) if times else None), None
    raise KeyError(key)

def check_freshness(as_of, replay):
    for key, name, where, warn_h, fail_h in FRESHNESS:
        try:
            t, entries = fresh_at(key, as_of, replay)
        except Exception as e:
            add("FAIL", "fresh", f"{name}读不到（{where}）：{e}"); continue
        if t == "SKIP":
            add("SKIP", "fresh", f"{name}：回放模式不查"); continue
        if t is None:
            add("FAIL", "fresh", f"{name}没有任何记录（{where}）"); continue
        age = (as_of - t).total_seconds() / 3600
        msg = f"{name} {t:%m-%d %H:%M} 更新（{age:.0f} 小时前；告警 {warn_h}h / 失败 {fail_h}h）"
        level = "FAIL" if age > fail_h else "WARN" if age > warn_h else "OK"
        add(level, "fresh", msg if level == "OK" else f"{msg}，没跟上（取自{where}）")
        if entries == 0:
            level, msg = assess_empty_hot_board(t, as_of, last_sync_at())
            add(level, "hot", msg)


# 热点榜空列表：默认只 WARN。若当前口径（默认 heat，允许单来源）已有候选，
# 且已经过了「下一轮同步本应写上新榜」的时间，才升级为 FAIL——这是线上空了多日却没人发现的那种无声故障。
# 同步点是每天 9:30 / 20:30；再留 30 分钟给导入员跑完（10:00 / 21:00）才按墙钟升级。
# 若本机 site-sync.json 显示已经在下一轮同步点之后同步过，也立刻升级（不必等满这 30 分钟）。
SYNC_SLOTS = ((9, 30), (20, 30))
HOT_REFRESH_GRACE = dt.timedelta(minutes=30)
HEAT_WINDOW = "48 hours"

def hot_ranking_mode():
    m = (os.environ.get("HOT_RANKING_MODE") or "").strip()
    if not m:
        try:
            env = dict(os.environ, DOCKER_HOST=os.environ.get("DOCKER_HOST", "tcp://127.0.0.1:2375"))
            api = os.environ.get("EDUHOT_API_CONTAINER", "xintian-edu-hot-api-1")
            p = subprocess.run(["docker", "exec", api, "printenv", "HOT_RANKING_MODE"],
                               capture_output=True, text=True, env=env, timeout=10)
            m = (p.stdout or "").strip()
        except Exception:
            m = ""
    return "threshold" if m == "threshold" else "heat"

def last_sync_at():
    try:
        raw = json.load(open(f"{REPO}/.data/site-sync.json")).get("syncedAt", "")
        return dt.datetime.strptime(raw, "%Y-%m-%d %H:%M").replace(tzinfo=TZ) if raw else None
    except Exception:
        return None

def next_scheduled_sync(computed_at):
    """computed_at 之后的下一个 9:30 / 20:30（北京时间）。"""
    day = computed_at.date()
    for _ in range(3):
        for h, m in SYNC_SLOTS:
            cand = dt.datetime(day.year, day.month, day.day, h, m, tzinfo=TZ)
            if cand > computed_at:
                return cand
        day += dt.timedelta(days=1)
    raise RuntimeError("next_scheduled_sync")

def hot_board_should_have_refreshed(computed_at, as_of, last_sync=None):
    nxt = next_scheduled_sync(computed_at)
    if last_sync is not None and last_sync >= nxt:
        return True
    return as_of >= nxt + HOT_REFRESH_GRACE

def count_hot_candidates(mode, at):
    """与 computeHotRanking 同一道门：48 小时窗口内，heat 要 ≥1 个精选源；threshold 还要 ≥2 个独立来源。已撤回的来源不计入。"""
    sql = f"""
    WITH cs AS (
      SELECT DISTINCT ON (ss.story_id, ss.participant_key)
        ss.story_id, ss.observed_at,
        CASE WHEN s.participation_mode = 'editorial' THEN 'editorial' ELSE 'signal' END AS kind
      FROM story_signals ss
      JOIN articles a ON a.id = ss.article_id
      JOIN sources s ON s.id = a.source_id
      LEFT JOIN publications p ON p.article_id = ss.article_id
      WHERE s.participation_mode <> 'isolated'
        AND coalesce(p.visibility, 'public') <> 'withdrawn'
        AND (s.participation_mode <> 'editorial' OR EXISTS (
          SELECT 1 FROM fact_articles fa JOIN facts f ON f.id = fa.fact_id
          WHERE fa.article_id = ss.article_id AND f.story_id = ss.story_id
            AND fa.role <> 'mention'
            AND (fa.manual IS TRUE OR NOT EXISTS (
              SELECT 1 FROM analyses evidence_an
              WHERE evidence_an.id = p.analysis_id AND evidence_an.output->>'scope' = 'composite'
            ))
        ))
      ORDER BY ss.story_id, ss.participant_key, (ss.kind = 'editorial') DESC, ss.observed_at DESC
    ),
    obs AS (
      SELECT story_id,
        count(*) FILTER (WHERE observed_at > timestamp with time zone '{at.isoformat()}' - interval '{HEAT_WINDOW}'
                           AND observed_at <= timestamp with time zone '{at.isoformat()}') AS participants,
        count(*) FILTER (WHERE observed_at > timestamp with time zone '{at.isoformat()}' - interval '{HEAT_WINDOW}'
                           AND observed_at <= timestamp with time zone '{at.isoformat()}'
                           AND kind = 'editorial') AS editorial
      FROM cs GROUP BY story_id
    )
    SELECT count(*) FROM obs o JOIN stories st ON st.id = o.story_id
    WHERE st.merged_into IS NULL AND editorial >= 1
      {'AND participants >= 2' if mode == 'threshold' else ''};
    """
    return int(psql(sql)[0][0])

def assess_empty_hot_board(computed_at, as_of, last_sync=None, mode=None, candidates=None):
    mode = mode or hot_ranking_mode()
    try:
        cand = count_hot_candidates(mode, as_of) if candidates is None else int(candidates)
        cand_txt = str(cand)
    except Exception:
        cand, cand_txt = None, "未查到"
    if mode == "threshold":
        gate = "48 小时内至少 2 个独立来源且含 1 个精选源的事件数"
    else:
        gate = "48 小时内至少 1 个精选源的事件数"
    msg = f"线上热点榜 0 条；本机 {mode} 口径 candidates={cand_txt}（{gate}）"
    if cand is not None and cand >= 1 and hot_board_should_have_refreshed(computed_at, as_of, last_sync):
        due = next_scheduled_sync(computed_at) + HOT_REFRESH_GRACE
        return "FAIL", f"{msg}，过了应刷新的一轮（{due:%m-%d %H:%M} 后仍是空榜）"
    return "WARN", msg

def check_host_deps():
    """sync-to-neon.sh 在宿主机跑 migrate.ts，要 node_modules/@aihot/backend；盒子重启可能把它清掉。"""
    if os.path.exists(f"{REPO}/node_modules/@aihot/backend"):
        add("OK", "deps", "宿主机 node_modules/@aihot/backend 在")
    else:
        add("FAIL", "deps", f"宿主机 {REPO}/node_modules/@aihot/backend 不在 → 在 {REPO} 跑 npm ci（sync-to-neon.sh、score-and-compose.sh 开头也会自动补装）")

# ---------- checkout drift ----------
def git(*a):
    p = subprocess.run(["git", "-C", REPO, *a], capture_output=True, text=True)
    return p.returncode, p.stdout.strip()

def check_checkout():
    rc, main = git("rev-parse", "--verify", "-q", "jiang/main")
    if rc:
        add("WARN", "checkout", "本地没有 jiang/main 引用，没法比对"); return
    _, branch = git("rev-parse", "--abbrev-ref", "HEAD")
    behind = []; ahead = []
    for f in OPS_SCRIPTS:
        rc_h, h = git("rev-parse", "-q", "--verify", f"HEAD:{f}")
        rc_m, m = git("rev-parse", "-q", "--verify", f"jiang/main:{f}")
        if rc_m == 0 and (rc_h != 0 or h != m):
            # 主线上这个文件比本分支新（本分支没有这个提交）才算缺
            rc_c, _ = git("merge-base", "--is-ancestor", git("log", "-1", "--format=%H", "jiang/main", "--", f)[1], "HEAD")
            if rc_c != 0: behind.append(f)
        if rc_h == 0 and (rc_m != 0 or h != m):
            rc_c, _ = git("merge-base", "--is-ancestor", git("log", "-1", "--format=%H", "HEAD", "--", f)[1], "jiang/main")
            if rc_c != 0: ahead.append(f)
    if behind:
        add("WARN", "checkout", f"运维目录（分支 {branch}）缺主线 jiang/main 上的新版：{', '.join(behind)}")
    if ahead:
        add("WARN", "checkout", f"这些运维脚本只在分支 {branch}、没进 jiang/main，谁切回 main 就会丢：{', '.join(ahead)}")
    if not behind and not ahead:
        add("OK", "checkout", f"运维目录（{branch}）和 jiang/main 的运维脚本一致")

def summary(results):
    """最后一行和退出码：FAIL 优先，其次 PENDING（CDN 待复查），否则 OK。"""
    fails = [r for r in results if r[0] == "FAIL"]; pends = [r for r in results if r[0] == "PEND"]
    if fails: return f"HEALTH FAIL: {fails[0][2]}", 1
    if pends: return f"HEALTH PENDING: {pends[0][2]}", 2
    return f"HEALTH OK（{sum(r[0] == 'WARN' for r in results)} 条提示）", 0

def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--as-of"); ap.add_argument("--slot", choices=["am", "pm"])
    ap.add_argument("--only", choices=["inputs", "db", "live", "cdn", "fresh", "deps", "checkout"]); ap.add_argument("--json", action="store_true")
    ap.add_argument("--wait-for-cdn", action="store_true", help="CDN 没追上就等到复查时间（同步后约 17.5 分钟）再判，只出 OK/FAIL；超过前台 13 分钟上限，要放后台跑，见 runbook")
    a = ap.parse_args()
    now = dt.datetime.now(TZ)
    as_of = dt.datetime.fromisoformat(a.as_of).astimezone(TZ) if a.as_of else now
    replay = a.as_of is not None and abs((now - as_of).total_seconds()) > 300
    slot = a.slot or ("am" if as_of.hour < 15 else "pm")
    run = lambda k: a.only in (None, k)
    if run("inputs"):
        check_inputs(
            as_of, slot,
            hotposts_snapshot=f"{REPO}/.data/notion-hotposts/snapshot.json",
            hotposts_stamp=f"{REPO}/.data/notion-hotposts/import-stamp.json",
        )
    latest = None
    if run("db") or run("live"):
        latest = check_db(as_of) if (run("db") or not replay) else None
    if run("live"):
        if replay: add("SKIP", "live", "回放模式不查线上")
        elif latest is not False: check_live(latest)
    if run("cdn"):
        if replay: add("SKIP", "cdn", "回放模式不查线上")
        else: check_cdn(wait=a.wait_for_cdn)
    if run("fresh") and latest is not False: check_freshness(as_of, replay)
    if run("deps") and not replay: check_host_deps()
    if run("checkout") and not replay: check_checkout()
    if a.json:
        print(json.dumps({"as_of": as_of.isoformat(), "slot": slot, "results": results}, ensure_ascii=False))
    else:
        print(f"# 教育AIHOT 健康检查 as-of {as_of:%Y-%m-%d %H:%M} 北京时间 slot={slot}{' (回放)' if replay else ''}")
        for lv, ck, msg in results: print(f"{lv:<4} {ck:<8} {msg}")
    line, code = summary(results)
    print(line)
    sys.exit(code)

if __name__ == "__main__":
    main()
