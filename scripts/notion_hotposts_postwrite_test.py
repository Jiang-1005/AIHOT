#!/usr/bin/env python3
"""写后 817 条 view 正文的封存与导入。只读证据包，输出写到临时目录。"""
from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUNDLE = Path(os.environ.get(
    "NOTION_POSTWRITE_BUNDLE",
    "/tmp/notion-postwrite-review/review-bundle",
))


def run(args):
    return subprocess.run(["python3", *args], cwd=ROOT, capture_output=True, text=True)


class Postwrite817(unittest.TestCase):
    def setUp(self):
        if not (BUNDLE / "pages" / "view-p09.txt").exists():
            self.skipTest("写后证据包不在这台机器上")
        self.tmp = tempfile.TemporaryDirectory()
        self.out = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_seal_check_scrub_import_rerun_and_health(self):
        bodies = [str(BUNDLE / "pages" / f"view-p0{i}.txt") for i in range(1, 10)]
        snapshot = self.out / "snapshot.json"
        sealed = run([
            "scripts/notion-hotposts-snapshot.py", "seal-view-pages",
            *[arg for path in bodies for arg in ("--body", path)],
            "--cursor-chain", str(BUNDLE / "cursor-chain.json"),
            "--fetched-at", "2026-11-24T14:34:48+08:00",
            "--page-size", "100",
            "--declared-n", "817",
            "--out", str(snapshot),
        ])
        self.assertEqual(sealed.returncode, 0, sealed.stderr)
        self.assertNotIn("s:mcp_all", sealed.stdout)
        info = json.loads(sealed.stdout)
        self.assertEqual(info["rows"], 817)
        self.assertEqual(info["final_page_next_cursor"], "absent")
        self.assertEqual(info["requests"], "reconstructed-not-original")
        checked = run(["scripts/notion-hotposts-snapshot.py", "check", "--snapshot", str(snapshot)])
        self.assertEqual(checked.returncode, 0, checked.stderr)
        snap = json.loads(snapshot.read_text(encoding="utf-8"))
        self.assertNotIn("s:mcp_all", snapshot.read_text(encoding="utf-8"))
        plats = {}
        for post in snap["posts"]:
            plats[post["platform"]] = plats.get(post["platform"], 0) + 1
        self.assertEqual(plats, {"X": 436, "小红书": 381})
        page = json.loads((BUNDLE / "pages" / "view-p09.txt").read_text(encoding="utf-8"))
        self.assertNotIn("next_cursor", page)
        self.assertIs(page["has_more"], False)

        scrub = self.out / "xhs-scrubbed.json"
        scrub_report = self.out / "xhs-scrub-report.json"
        scrubbed = run([
            "scripts/scrub-xhs.py", "--snapshot", str(snapshot),
            "--out", str(scrub), "--report", str(scrub_report),
        ])
        self.assertEqual(scrubbed.returncode, 0, scrubbed.stderr)
        self.assertNotIn("xsec_token", scrub.read_text(encoding="utf-8"))
        redacted = json.loads(scrubbed.stdout)["redactedRows"]

        voices = BUNDLE / "freeze" / "voices.json"
        stamp = self.out / "stamp.json"
        report = self.out / "report.json"
        catalog = self.out / "voices.json"
        common = [
            "scripts/import-voices.py",
            "--notion-snapshot", str(snapshot),
            "--baseline", str(voices),
            "--retain-baseline-union",
            "--scrubbed", str(scrub),
            "--out", str(catalog),
            "--report", str(report),
            "--stamp", str(stamp),
        ]
        dry = run([*common, "--dry-run"])
        self.assertEqual(dry.returncode, 0, dry.stderr)
        self.assertFalse(catalog.exists())
        self.assertFalse(stamp.exists())
        dry_stats = json.loads(dry.stdout)["stats"]
        written = run(common)
        self.assertEqual(written.returncode, 0, written.stderr)
        stats = json.loads(written.stdout)["stats"]
        self.assertEqual(stats, dry_stats)
        self.assertEqual(stats["duplicates"], 0)
        self.assertEqual(stats["added"], 142)
        self.assertEqual(stats["skipped"], 675)
        self.assertEqual(stats["retained_baseline"], 83)
        self.assertEqual(json.loads(stamp.read_text(encoding="utf-8"))["ok"], True)
        data = json.loads(catalog.read_text(encoding="utf-8"))
        baseline = json.loads(voices.read_text(encoding="utf-8"))
        base = {item["url"]: item for item in baseline["items"]}
        got = {item["url"]: item for item in data["items"]}
        self.assertEqual(len(got), len(data["items"]))
        counts = {}
        authors = 0
        for item in data["items"]:
            counts[item["platform"]] = counts.get(item["platform"], 0) + 1
            if item["platform"] == "小红书":
                self.assertEqual(item.get("author") or "", "")
                self.assertNotIn("image", item)
                self.assertNotIn("cover", item)
                if item.get("author"):
                    authors += 1
        self.assertEqual(counts["X"], 436)
        self.assertEqual(counts["小红书"], 381)
        self.assertEqual(counts["知乎"], 40)
        self.assertEqual(counts["微博"], 32)
        self.assertEqual(counts["B站"], 9)
        self.assertEqual(counts["豆瓣"], 1)
        self.assertEqual(counts["即刻"], 1)
        self.assertEqual(authors, 0)
        self.assertNotIn("xsec_token", catalog.read_text(encoding="utf-8"))
        text_changed = metrics_changed = verified_changed = tag_changed = publish_filled = 0
        verified_not_lifted = 0
        for url, old in base.items():
            if old["platform"] not in {"X", "小红书"}:
                self.assertEqual(got[url]["title"], old["title"])
                continue
            new = got[url]
            if (new.get("title"), new.get("summary")) != (old.get("title"), old.get("summary")):
                text_changed += 1
            if (new.get("metrics") or {}).get("likes") != (old.get("metrics") or {}).get("likes"):
                metrics_changed += 1
            if bool(new.get("verified")) != bool(old.get("verified")):
                verified_changed += 1
            if (new.get("tags") or {}).get("content_type") != (old.get("tags") or {}).get("content_type"):
                tag_changed += 1
            if (new.get("tags") or {}).get("topic") != (old.get("tags") or {}).get("topic"):
                tag_changed += 1
            if not old.get("day") and new.get("day"):
                publish_filled += 1
            if old.get("verified") is False and new.get("verified") is True:
                verified_not_lifted += 1
        self.assertEqual(text_changed, 0)
        self.assertEqual(metrics_changed, 0)
        self.assertEqual(verified_changed, 0)
        self.assertEqual(tag_changed, 0)
        self.assertEqual(publish_filled, 0)
        self.assertEqual(verified_not_lifted, 0)
        new_urls = [url for url in got if url not in base]
        self.assertEqual(len(new_urls), 142)
        unmapped = 0
        missing_publish = 0
        for url in new_urls:
            item = got[url]
            if item["platform"] == "小红书" and not item.get("day"):
                missing_publish += 1
                self.assertNotEqual(item.get("day"), (item.get("metrics") or {}).get("captured_at"))
            status = (item.get("tags") or {}).get("content_type_status")
            if status == "unmapped":
                unmapped += 1
                self.assertNotIn((item.get("tags") or {}).get("content_type"), {"新闻快讯", "官方发布", "深度分析", "测评体验", "研究报告", "观点评论", "教程与提示词", "用户自述"})
        self.assertGreater(missing_publish, 0)
        self.assertGreater(unmapped, 0)

        second = self.out / "voices-2.json"
        second_stamp = self.out / "stamp-2.json"
        again = run([
            "scripts/import-voices.py",
            "--notion-snapshot", str(snapshot),
            "--baseline", str(catalog),
            "--retain-baseline-union",
            "--scrubbed", str(scrub),
            "--out", str(second),
            "--stamp", str(second_stamp),
        ])
        self.assertEqual(again.returncode, 0, again.stderr)
        again_stats = json.loads(again.stdout)["stats"]
        self.assertEqual(again_stats["added"], 0)
        self.assertEqual(again_stats["changed"], 0)
        self.assertEqual(again_stats["duplicates"], 0)
        self.assertEqual(
            [item["url"] for item in json.loads(second.read_text(encoding="utf-8"))["items"]],
            [item["url"] for item in data["items"]],
        )
        gate = run([
            "scripts/notion-hotposts-snapshot.py", "gate-sync",
            "--snapshot", str(snapshot), "--stamp", str(stamp),
        ])
        self.assertEqual(gate.returncode, 0, gate.stderr)

        spec = importlib.util.spec_from_file_location("pipeline_health", ROOT / "scripts" / "check-pipeline-health.py")
        health = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(health)
        health.results.clear()
        moment = datetime.now(timezone(timedelta(hours=8))) + timedelta(minutes=1)
        health.check_notion_hotposts(moment, "pm", str(snapshot), str(stamp))
        rows = [(lv, msg) for lv, ck, msg in health.results if ck == "inputs"]
        self.assertTrue(any(lv == "OK" and "完整" in msg for lv, msg in rows), rows)
        self.assertTrue(any(lv == "OK" and "哈希一致" in msg for lv, msg in rows), rows)
        self.assertFalse(any(lv == "FAIL" for lv, msg in rows), rows)

        durable = Path("/tmp/postwrite-817-summary.json")
        summary = {
            "snapshot_rows": 817,
            "platforms": plats,
            "catalog_counts": counts,
            "stats": stats,
            "rerun": again_stats,
            "field_policy": json.loads(written.stdout)["field_policy"],
            "xhs_redacted_rows": redacted,
            "existing_cards_text_changed": text_changed,
            "existing_cards_likes_changed": metrics_changed,
            "existing_cards_verified_changed": verified_changed,
            "existing_cards_tags_changed": tag_changed,
            "new_urls": len(new_urls),
            "new_unmapped_content_types": unmapped,
            "new_xhs_missing_publish_date": missing_publish,
        }
        text = json.dumps(summary, ensure_ascii=False, indent=2) + "\n"
        (self.out / "summary.json").write_text(text, encoding="utf-8")
        durable.write_text(text, encoding="utf-8")
        print(text)


if __name__ == "__main__":
    unittest.main()
