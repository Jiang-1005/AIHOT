#!/usr/bin/env python3
"""Observable behavior of check-pipeline-health.py: radar checklist vs extra names, and empty hot board."""
import importlib.util
import datetime as dt
import os
import tempfile
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location(
    "pipeline_health", Path(__file__).with_name("check-pipeline-health.py")
)
h = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(h)
TZ = h.TZ

def at(s):
    return dt.datetime.fromisoformat(s).replace(tzinfo=TZ)

class RadarInputs(unittest.TestCase):
    def setUp(self):
        h.results.clear()
        self.tmp = tempfile.TemporaryDirectory()
        self.radar = Path(self.tmp.name) / "radar"
        self.briefs = Path(self.tmp.name) / "briefs"
        self.radar.mkdir()
        self.briefs.mkdir()

    def tearDown(self):
        self.tmp.cleanup()

    def touch(self, name, when=None):
        p = self.radar / name
        p.write_text("url\n", encoding="utf-8")
        if when is not None:
            ts = when.timestamp()
            os.utime(p, (ts, ts))
        return p

    def run_inputs(self, as_of, slot):
        h.results.clear()
        h.check_inputs(as_of, slot, radar_dir=str(self.radar), briefs=str(self.briefs))
        return [(lv, ck, msg) for lv, ck, msg in h.results if ck == "inputs" and "雷达" in msg]

    def test_slot_due_radar_pm_is_after_1920(self):
        # Convention is 19:20; the script keeps a 15-minute grace, so 19:34 is not yet due.
        self.assertFalse(h.slot_due(at("2026-11-17T19:20:00"), "pm", "radar"))
        self.assertFalse(h.slot_due(at("2026-11-17T19:34:00"), "pm", "radar"))
        self.assertTrue(h.slot_due(at("2026-11-17T19:35:00"), "pm", "radar"))

    def test_missing_pm_before_due_is_warn_even_with_misnamed_files(self):
        t = at("2026-11-17T13:26:00")
        self.touch("x-posts-feishu-new-20261117-noon.csv", t)
        self.touch("x-posts-feishu-new-2026-11-17-am.csv", t)
        rows = self.run_inputs(at("2026-11-17T15:34:00"), "pm")
        levels = {msg: lv for lv, _, msg in rows}
        missing = [msg for msg in levels if "x-posts-feishu-new-20261117-pm.csv 还没到" in msg]
        self.assertEqual(len(missing), 1, rows)
        self.assertEqual(levels[missing[0]], "WARN")
        self.assertTrue(all(lv != "FAIL" for lv, _, msg in rows))
        self.assertTrue(any(lv == "WARN" and "noon.csv" in msg and "不计入缺件" in msg for lv, _, msg in rows))
        self.assertTrue(any(lv == "WARN" and "2026-11-17-am.csv" in msg and "不计入缺件" in msg for lv, _, msg in rows))

    def test_missing_pm_after_due_is_fail_and_misnamed_stays_warn(self):
        self.touch("x-posts-feishu-new-20261117-noon.csv", at("2026-11-17T13:26:00"))
        rows = self.run_inputs(at("2026-11-17T19:40:00"), "pm")
        radar = [(lv, msg) for lv, _, msg in rows]
        self.assertTrue(any(lv == "FAIL" and "x-posts-feishu-new-20261117-pm.csv 还没到" in msg for lv, msg in radar), radar)
        self.assertTrue(any(lv == "WARN" and "noon.csv" in msg for lv, msg in radar), radar)
        self.assertFalse(any("文件名不合约定" in msg and lv == "FAIL" for lv, msg in radar))

    def test_canonical_present_extras_are_warn_not_fail(self):
        t = at("2026-11-17T09:00:00")
        self.touch("x-posts-feishu-new-20261117-am.csv", t)
        self.touch("x-posts-feishu-new-2026-11-17-am.csv", t)
        rows = self.run_inputs(at("2026-11-17T10:00:00"), "am")
        self.assertTrue(any(lv == "OK" and "x-posts-feishu-new-20261117-am.csv 在" in msg for lv, _, msg in rows), rows)
        self.assertTrue(any(lv == "WARN" and "2026-11-17-am.csv" in msg for lv, _, msg in rows), rows)
        self.assertFalse(any(lv == "FAIL" for lv, _, _ in rows), rows)


class EmptyHotBoard(unittest.TestCase):
    def test_next_sync_after_morning_computed_at_is_2030(self):
        self.assertEqual(h.next_scheduled_sync(at("2026-11-17T13:18:00")), at("2026-11-17T20:30:00"))
        self.assertEqual(h.next_scheduled_sync(at("2026-11-17T20:30:00")), at("2026-11-18T09:30:00"))
        self.assertEqual(h.next_scheduled_sync(at("2026-11-17T09:29:00")), at("2026-11-17T09:30:00"))

    def test_13_18_empty_board_stays_warn_before_next_round(self):
        computed = at("2026-11-17T13:18:21")
        last_sync = at("2026-11-17T13:20:00")
        now = at("2026-11-17T15:34:00")
        self.assertFalse(h.hot_board_should_have_refreshed(computed, now, last_sync))
        level, msg = h.assess_empty_hot_board(computed, now, last_sync, mode="heat", candidates=10)
        self.assertEqual(level, "WARN")
        self.assertIn("candidates=10", msg)
        self.assertIn("至少 1 个精选源", msg)
        self.assertNotIn("至少 2 个来源", msg)
        self.assertNotIn("至少 2 个独立来源", msg)

    def test_upgrades_to_fail_after_grace_when_candidates_exist(self):
        computed = at("2026-11-17T13:18:21")
        last_sync = at("2026-11-17T13:20:00")
        # 21:00 is 20:30 + 30 minutes; 20:59 must still be WARN so a mid-round check is not blocked.
        self.assertFalse(h.hot_board_should_have_refreshed(computed, at("2026-11-17T20:59:00"), last_sync))
        self.assertTrue(h.hot_board_should_have_refreshed(computed, at("2026-11-17T21:00:00"), last_sync))
        level, msg = h.assess_empty_hot_board(computed, at("2026-11-17T21:00:00"), last_sync, mode="heat", candidates=10)
        self.assertEqual(level, "FAIL")
        self.assertIn("candidates=10", msg)
        self.assertIn("过了应刷新的一轮", msg)

    def test_upgrades_when_a_later_sync_already_ran(self):
        computed = at("2026-11-17T13:18:21")
        last_sync = at("2026-11-17T20:35:00")
        now = at("2026-11-17T20:36:00")
        self.assertTrue(h.hot_board_should_have_refreshed(computed, now, last_sync))
        level, _ = h.assess_empty_hot_board(computed, now, last_sync, mode="heat", candidates=3)
        self.assertEqual(level, "FAIL")

    def test_zero_candidates_stay_warn_even_after_grace(self):
        computed = at("2026-11-17T13:18:21")
        level, msg = h.assess_empty_hot_board(computed, at("2026-11-17T21:00:00"), None, mode="heat", candidates=0)
        self.assertEqual(level, "WARN")
        self.assertIn("candidates=0", msg)
        self.assertNotIn("过了应刷新的一轮", msg)

    def test_threshold_message_keeps_two_source_gate(self):
        level, msg = h.assess_empty_hot_board(
            at("2026-11-17T13:18:21"), at("2026-11-17T15:34:00"), None, mode="threshold", candidates=0
        )
        self.assertEqual(level, "WARN")
        self.assertIn("threshold", msg)
        self.assertIn("至少 2 个独立来源且含 1 个精选源", msg)



class IndustryInputs(unittest.TestCase):
    def setUp(self):
        h.results.clear()
        self.tmp = tempfile.TemporaryDirectory()
        self.radar = Path(self.tmp.name) / "radar"
        self.briefs = Path(self.tmp.name) / "briefs"
        self.radar.mkdir()
        self.briefs.mkdir()

    def tearDown(self):
        self.tmp.cleanup()

    def write_csv(self, rel, urls, when, header=True):
        p = self.briefs / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        if header:
            lines = ["原文链接,标题"] + [f"{u},t" for u in urls]
        else:
            lines = ["标题"] + ["t" for _ in urls]
        p.write_text("\n".join(lines) + "\n", encoding="utf-8")
        ts = when.timestamp()
        os.utime(p, (ts, ts))
        return p

    def run_inputs(self, as_of, slot):
        h.results.clear()
        h.check_inputs(as_of, slot, radar_dir=str(self.radar), briefs=str(self.briefs))
        return [(lv, msg) for lv, ck, msg in h.results if ck == "inputs" and "雷达" not in msg]

    def test_official_name_list_matches_importer(self):
        self.assertEqual(h.OFFICIAL_ITEMS_NAMES, ("items.csv", "items-pm.csv", "items-evening.csv"))
        self.assertTrue(h.importer_auto_reads_items("items.csv"))
        self.assertTrue(h.importer_auto_reads_items("items-pm.csv"))
        self.assertTrue(h.importer_auto_reads_items("items-evening.csv"))
        self.assertFalse(h.importer_auto_reads_items("items-noon.csv"))
        self.assertFalse(h.importer_auto_reads_items("items.dedup.csv"))
        src = Path(h.__file__).with_name("import-brief-items.ts").read_text(encoding="utf-8")
        self.assertIn('new Set(["items.csv", "items-pm.csv", "items-evening.csv"])', src)
        self.assertNotIn("items*.csv", src.split("function discoverFiles", 1)[1].split("function uniqueExisting", 1)[0])

    def test_noon_extras_are_warn_because_importer_will_not_read_them(self):
        t = at("2026-11-17T13:24:00")
        self.write_csv("daily-2026-11-17/items.csv", ["https://official.example/a"], t)
        self.write_csv("daily-2026-11-17/items-noon.csv", [
            "https://www.edu.tw/News_Content.aspx?n=9E7AC85F1954DDA8&s=C11B7907E97AA5F9",
            "https://www.jiji.com/jc/article?k=000000014.000126494&g=prt",
        ], t)
        rows = self.run_inputs(at("2026-11-17T15:49:00"), "pm")
        noon = [(lv, msg) for lv, msg in rows if "items-noon.csv" in msg]
        self.assertEqual(len(noon), 1, rows)
        self.assertEqual(noon[0][0], "WARN")
        self.assertIn("2 条不在正式 items 里", noon[0][1])
        self.assertIn("不会读进来", noon[0][1])
        self.assertFalse(any(lv == "FAIL" for lv, _ in rows), rows)
        self.assertTrue(any(lv == "WARN" and "items-pm.csv 还没到" in msg for lv, msg in rows), rows)

    def test_dedup_without_url_col_is_warn_not_fail(self):
        t = at("2026-11-17T12:20:00")
        self.write_csv("daily-2026-11-17/items.csv", ["https://official.example/a"], t)
        self.write_csv("daily-2026-11-17/items.dedup.核验清单.csv", ["ignored"], t, header=False)
        rows = self.run_inputs(at("2026-11-17T12:30:00"), "am")
        hit = [(lv, msg) for lv, msg in rows if "核验清单" in msg]
        self.assertEqual(len(hit), 1, rows)
        self.assertEqual(hit[0][0], "WARN")
        self.assertIn("不会读进来", hit[0][1])
        self.assertFalse(any(lv == "FAIL" for lv, _ in rows), rows)

    def test_fail_reserved_for_files_the_importer_would_still_read(self):
        level, msg = h.assess_extra_items_file("items-noon.csv", extra_count=2, will_read=True, has_url_col=True)
        self.assertEqual(level, "FAIL")
        self.assertIn("会被 import-brief-items.ts 一起读进来", msg)
        self.assertIn("2 条不在正式 items 里", msg)
        level, msg = h.assess_extra_items_file("items-noon.csv", extra_count=2, will_read=False, has_url_col=True)
        self.assertEqual(level, "WARN")
        self.assertIn("不会读进来", msg)


class CdnStaleness(unittest.TestCase):
    """Visitors read non-ts URLs through the CDN: right after a sync they may lag; past s-maxage+SWR they must not."""
    SYNC = at("2026-11-17T20:44:00")

    def probes(self, voices, hot, origin_hot="2026-11-17T20:42:00"):
        v = at(voices) if voices else None
        hh = at(hot) if hot else None
        return [("/api/site/voices 数据截至", v, self.SYNC, "HIT/age 1"),
                ("/hot 更新时间", hh, at(origin_hot), "STALE/age 900")]

    def levels(self, verdict):
        return [lv for lv, _ in verdict]

    def test_caught_up_is_ok(self):
        v = h.assess_cdn(self.probes("2026-11-17T20:44:00", "2026-11-17T20:42:00"), self.SYNC, at("2026-11-17T20:46:00"))
        self.assertEqual(self.levels(v), ["OK"])

    def test_behind_right_after_sync_only_warns(self):
        v = h.assess_cdn(self.probes("2026-11-17T13:20:00", "2026-11-17T13:18:00"), self.SYNC, at("2026-11-17T20:50:00"))
        self.assertEqual(self.levels(v), ["WARN"])
        self.assertIn("21:01", v[0][1])  # 20:44 + 600 s + 300 s + 120 s

    def test_behind_after_deadline_fails(self):
        v = h.assess_cdn(self.probes("2026-11-17T13:20:00", "2026-11-17T20:42:00"), self.SYNC, at("2026-11-17T20:57:00") + dt.timedelta(minutes=5))
        self.assertEqual(self.levels(v), ["FAIL"])
        self.assertIn("13:20", v[0][1])

    def test_unparsable_live_value_counts_as_behind(self):
        v = h.assess_cdn(self.probes(None, "2026-11-17T20:42:00"), self.SYNC, at("2026-11-17T22:00:00"))
        self.assertEqual(self.levels(v), ["FAIL"])

    def test_unpurged_sync_is_flagged_even_when_caught_up(self):
        purge = {"at": "2026-11-17T20:44:30+08:00", "status": "no-token", "exitCode": 3}
        v = h.assess_cdn(self.probes("2026-11-17T20:44:00", "2026-11-17T20:42:00"), self.SYNC, at("2026-11-17T21:10:00"), purge)
        self.assertEqual(self.levels(v), ["WARN", "OK"])
        self.assertIn("VERCEL_TOKEN", v[0][1])

    def test_old_purge_record_is_ignored(self):
        purge = {"at": "2026-11-16T20:44:30+08:00", "status": "no-token", "exitCode": 3}
        v = h.assess_cdn(self.probes("2026-11-17T20:44:00", "2026-11-17T20:42:00"), self.SYNC, at("2026-11-17T21:10:00"), purge)
        self.assertEqual(self.levels(v), ["OK"])

    def test_unpurged_sync_waits_past_the_deadline(self):
        purge = {"at": "2026-11-17T20:44:30+08:00", "status": "no-token", "exitCode": 3}
        wait = h.auto_cdn_wait(purge, self.SYNC, at("2026-11-17T20:45:00"))
        self.assertEqual(wait, 16 * 60 + 30)  # until 21:01 (sync + 17 min) plus 30 s
        self.assertLessEqual(h.auto_cdn_wait(purge, self.SYNC, at("2026-11-17T20:30:00")), h.CDN_AUTO_WAIT_CAP)
        self.assertEqual(h.auto_cdn_wait(purge, self.SYNC, at("2026-11-17T21:10:00")), 0)

    def test_purged_or_older_record_does_not_wait(self):
        self.assertEqual(h.auto_cdn_wait({"at": "2026-11-17T20:44:30+08:00", "status": "purged", "exitCode": 0}, self.SYNC, at("2026-11-17T20:45:00")), 0)
        self.assertEqual(h.auto_cdn_wait({"at": "2026-11-16T20:44:30+08:00", "status": "no-token", "exitCode": 3}, self.SYNC, at("2026-11-17T20:45:00")), 0)
        self.assertEqual(h.auto_cdn_wait(None, self.SYNC, at("2026-11-17T20:45:00")), 0)

    def test_parse_as_of_formats(self):
        self.assertEqual(h.parse_as_of("11 月 17 日 20:44 北京时间", 2026), at("2026-11-17T20:44:00"))
        self.assertEqual(h.parse_as_of("11月17日 20:42", 2026), at("2026-11-17T20:42:00"))
        self.assertIsNone(h.parse_as_of("", 2026))


if __name__ == "__main__":
    unittest.main()
