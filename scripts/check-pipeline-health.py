#!/usr/bin/env python3
"""教育AIHOT 端到端健康检查（只读）。

导入员每轮在 sync-to-neon.sh 之后跑一次；任何 bot 动过本机栈（重启、恢复、换分支）后也跑一次。
它不看「脚本跑没跑」，只看结果对不对：
  inputs   输入文件按约定命名、按时到位（雷达 x-posts-feishu-new-YYYYMMDD-am|pm.csv，行业 daily-YYYY-MM-DD/items.csv|items-pm.csv）
  db       本机库在、不空
  scoring  导进来的稿子 3 小时内打完分（worker 关着时靠 score-and-compose.sh）
  issue    最新日报不早于昨天（有新稿却没出刊 = 失败）
  worker   worker 心跳（关着是已知状态，只提示）
  live     线上最新日报 = 本机最新日报，线上「数据截至」不落后本机同步时间
  fresh    热帖、日报、周报、热点榜各自多久没更新，阈值见下面的 FRESHNESS 表；热点榜 0 条只提示，附 candidates 数
  checkout 运维目录 /workspace/edu-hot 没缺主线 jiang/main 上的运维脚本，本分支的运维脚本也已进主线

全部只读：docker exec psql SELECT、读文件、curl 公网只读接口、git 本地对象。不写库、不 push、不打印任何密钥。
退出码：0 = 没有 FAIL（可能有 WARN）；1 = 有 FAIL；最后一行是一句话结论。

  python3 scripts/check-pipeline-health.py                 # 现在
  python3 scripts/check-pipeline-health.py --slot am       # 指定早轮/晚轮（默认按时间：<15:00 为 am）
  python3 scripts/check-pipeline-health.py --as-of 2026-11-17T09:45:00+08:00   # 回放：只用当时已存在的数据（live 自动跳过）
  python3 scripts/check-pipeline-health.py --only inputs   # 只校验输入文件（给雷达、行业观察写完文件后自查）
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
]
OPS_SCRIPTS = ["scripts/sync-to-neon.sh", "scripts/export-to-neon.sh", "scripts/resolve-neon-urls.py",
               "scripts/reset-sequences.sql", "scripts/env-exports.py", "scripts/import-voices.py",
               "scripts/import-brief-items.ts", "scripts/score-and-compose.sh", "scripts/score-and-compose.ts",
               "scripts/check-pipeline-health.py", "docs/import-runbook.md"]

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
def check_inputs(as_of, slot):
    day = as_of.date(); ymd = day.strftime("%Y%m%d"); iso = day.isoformat()
    want = f"{RADAR_DIR}/x-posts-feishu-new-{ymd}-{slot}.csv"
    bad_pat = re.compile(r"^x-posts-feishu-new-(?!\d{8}-(am|pm)\.csv$).+\.csv$")
    misnamed = [os.path.basename(p) for p in glob.glob(f"{RADAR_DIR}/x-posts-feishu-new-*.csv")
                if bad_pat.match(os.path.basename(p)) and existed(p, as_of)
                and (iso in p or ymd in p)]
    if existed(want, as_of):
        add("OK", "inputs", f"雷达 {os.path.basename(want)} 在")
    elif misnamed:
        add("FAIL", "inputs", f"雷达文件名不合约定：{', '.join(misnamed)}，应为 {os.path.basename(want)}（日期 8 位不带横线，后缀只能 am/pm）")
    else:
        add("FAIL" if slot_due(as_of, slot, "radar") else "WARN", "inputs", f"雷达 {os.path.basename(want)} 还没到")
    for m in misnamed:
        if existed(want, as_of) and m != os.path.basename(want):
            add("WARN", "inputs", f"雷达目录里还有不合约定的同日文件 {m}（以后请直接按约定命名）")
    ddir = f"{BRIEFS}/daily-{iso}"
    canon = f"{ddir}/{'items.csv' if slot == 'am' else 'items-pm.csv'}"
    if existed(canon, as_of):
        add("OK", "inputs", f"行业 daily-{iso}/{os.path.basename(canon)} 在")
    else:
        alias = f"{ddir}/items-evening.csv"
        if slot == "pm" and existed(alias, as_of):
            add("WARN", "inputs", f"行业晚轮用了别名 items-evening.csv，约定是 items-pm.csv")
        else:
            add("FAIL" if slot_due(as_of, slot, "industry") else "WARN", "inputs", f"行业 daily-{iso}/{os.path.basename(canon)} 还没到")
    # import-brief-items.ts 读 ^items.*\.csv$：多出来的文件会被一起导入
    if os.path.isdir(ddir):
        canon_urls = set()
        for n in ("items.csv", "items-pm.csv", "items-evening.csv"):
            canon_urls |= urls_of(f"{ddir}/{n}", "原文链接")
        for p in sorted(glob.glob(f"{ddir}/items*.csv")):
            n = os.path.basename(p)
            if n in ("items.csv", "items-pm.csv", "items-evening.csv") or not existed(p, as_of):
                continue
            if not has_col(p, "原文链接"):
                add("WARN", "inputs", f"{n} 也匹配 items*.csv，但没有「原文链接」列，导入会整份跳过；中间文件请换个不以 items 开头的名字")
                continue
            extra = urls_of(p, "原文链接") - canon_urls
            if extra:
                add("FAIL", "inputs", f"{n} 会被 import-brief-items.ts 一起读进来，且有 {len(extra)} 条不在正式 items 里（候选/删掉的条目会上站）")
            else:
                add("WARN", "inputs", f"{n} 也匹配 items*.csv，目前和正式文件链接一致；中间文件请换个不以 items 开头的名字")

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
            try:
                cand = psql("SELECT coalesce(evidence->>'candidates','?') FROM hot_rankings ORDER BY computed_at DESC LIMIT 1")[0][0]
            except Exception:
                cand = "未查到"
            add("WARN", "hot", f"线上热点榜 0 条；本机最近一次 candidates={cand}（48 小时内够 2 个独立来源、含 1 个精选源的事件数）")

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

def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--as-of"); ap.add_argument("--slot", choices=["am", "pm"])
    ap.add_argument("--only", choices=["inputs", "db", "live", "fresh", "checkout"]); ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    now = dt.datetime.now(TZ)
    as_of = dt.datetime.fromisoformat(a.as_of).astimezone(TZ) if a.as_of else now
    replay = a.as_of is not None and abs((now - as_of).total_seconds()) > 300
    slot = a.slot or ("am" if as_of.hour < 15 else "pm")
    run = lambda k: a.only in (None, k)
    if run("inputs"): check_inputs(as_of, slot)
    latest = None
    if run("db") or run("live"):
        latest = check_db(as_of) if (run("db") or not replay) else None
    if run("live"):
        if replay: add("SKIP", "live", "回放模式不查线上")
        elif latest is not False: check_live(latest)
    if run("fresh") and latest is not False: check_freshness(as_of, replay)
    if run("checkout") and not replay: check_checkout()
    fails = [r for r in results if r[0] == "FAIL"]; warns = [r for r in results if r[0] == "WARN"]
    if a.json:
        print(json.dumps({"as_of": as_of.isoformat(), "slot": slot, "results": results}, ensure_ascii=False))
    else:
        print(f"# 教育AIHOT 健康检查 as-of {as_of:%Y-%m-%d %H:%M} 北京时间 slot={slot}{' (回放)' if replay else ''}")
        for lv, ck, msg in results: print(f"{lv:<4} {ck:<8} {msg}")
    print(f"HEALTH FAIL: {fails[0][2]}" if fails else f"HEALTH OK（{len(warns)} 条提示）")
    sys.exit(1 if fails else 0)

if __name__ == "__main__":
    main()
