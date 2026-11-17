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


if __name__ == "__main__":
    unittest.main()
