#!/usr/bin/env python3
"""Notion 热帖快照协议与导入。样本来自 2026-11-24 预写冻结里的真实行，另有一条植入的小红书脱敏行。"""
from __future__ import annotations

import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

import notion_hotposts as nh

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = Path(__file__).resolve().parent / "fixtures" / "notion-hotposts" / "connector-pages.json"
PREWRITE = Path("/home/ubuntu/.cursor/projects/agent-repos-AIHOT/uploads/notion-prewrite-rows_ae88.json")
GROK = Path("/home/ubuntu/.cursor/projects/agent-repos-AIHOT/uploads/grok-posts_8aa5.json")
PREWRITE_SHA = "3c222be980b7ce2efc37ca3fcb425903b1eba4f67542d199ea776cddd5ee3f02"
GROK_SHA = "328c2c3518ed996b69c8400063a826079f73a4106fbdc234501542ce9077ad64"

EXISTING = "https://x.com/worldteacherman/status/2053508596952871175"
NOTION_ONLY = "https://x.com/claudeai/status/2077047278078931243"
UNVERIFIED = "https://x.com/AshleyTorr79932/status/2110639198612914317"
CONFLICT = "https://x.com/unusual_whales/status/2117738486036148624"
MISSING = "https://x.com/sohn522/status/2111248416340836468"
XHS = "https://www.xiaohongshu.com/explore/6b044b670000000018029cc5"
PRIVACY = "https://www.xiaohongshu.com/explore/aabbccddeeff001122334455"
ZHIHU_OLD = "https://www.zhihu.com/question/190001"
ZHIHU_NEW = "https://www.zhihu.com/question/190002"


def run(args, cwd=ROOT):
    return subprocess.run([ "python3", *args ], cwd=cwd, capture_output=True, text=True)


class Protocol(unittest.TestCase):
    def test_shipped_map_accepts_nothing(self):
        mapping = nh.load_content_type_map()
        self.assertEqual(mapping["grok_content_types"], nh.CONTENT_TYPES)
        for name, entry in mapping["notion_content_types"].items():
            self.assertEqual(entry["review"], "unreviewed", name)
            self.assertIsNone(entry["site_content_type"], name)
            decided = nh.resolve_content_type(name, mapping)
            self.assertIsNone(decided["site_content_type"])
            self.assertTrue(decided["needs_review"])
        self.assertEqual(nh.resolve_content_type("教程")["site_content_type"], None)
        self.assertNotEqual(nh.resolve_content_type("教程")["site_content_type"], "教程与提示词")
        self.assertEqual(nh.resolve_content_type("观点讨论")["review"], "unreviewed")

    def test_seal_is_stable_and_strips_tracking(self):
        bundle = json.loads(FIXTURE.read_text(encoding="utf-8"))
        first = nh.seal_pages(bundle)
        second = nh.seal_pages(json.loads(FIXTURE.read_text(encoding="utf-8")))
        self.assertEqual(first["integrity"]["rows_sha256"], second["integrity"]["rows_sha256"])
        nh.verify_snapshot(first)
        blob = json.dumps(first, ensure_ascii=False)
        self.assertNotIn("xsec_token", blob)
        self.assertNotIn("SHOULD_NOT_LEAK", blob)
        by_key = {post["post_key"]: post for post in first["posts"]}
        xhs = by_key["xhs:6b044b670000000018029cc5"]
        self.assertIsNone(xhs["published_on"])
        self.assertEqual(xhs["captured_on"], "2026-11-24")
        self.assertIsNone(xhs["likes"])
        self.assertEqual(xhs["collects"], 2)
        self.assertNotEqual(xhs["canonical_url"], xhs["notion_page_url"])
        self.assertTrue(xhs["canonical_url"].startswith("https://www.xiaohongshu.com/explore/"))
        self.assertNotIn("?", xhs["canonical_url"])
        privacy = by_key["xhs:aabbccddeeff001122334455"]
        self.assertFalse(privacy["verified"])
        self.assertEqual(privacy["verification_status"], ["部分待核"])
        self.assertEqual(privacy["interaction_source"], "原帖底栏")
        partial = by_key["x:2110639198612914317"]
        self.assertFalse(partial["verified"])
        self.assertIn("部分待核", partial["verification_status"])
        self.assertEqual(partial["radar_content_type"], "新闻快讯")
        self.assertEqual(partial["notion_content_type"], "行业资讯")
        self.assertEqual(partial["likes"], 0)

    def test_page_time_and_created_time_are_not_publish_dates(self):
        bundle = json.loads(FIXTURE.read_text(encoding="utf-8"))
        row = json.loads(json.dumps(bundle["pages"][1]["results"][0]))
        row.pop("date:发布日期:start", None)
        row["页面时间"] = "2026-07-14"
        row["createdTime"] = "2026-11-24 06:02:10Z"
        row["date:采集日期:start"] = "2026-11-10"
        post = nh.normalize_connector_row(row)
        self.assertIsNone(post["published_on"])
        self.assertEqual(post["captured_on"], "2026-11-10")

    def test_inferred_status_is_not_verified(self):
        status, verified = nh.verification_of('["原帖已核","推断"]', "原帖已打开")
        self.assertEqual(status, ["原帖已核", "推断"])
        self.assertFalse(verified)
        _, opened = nh.verification_of('["原帖已核"]', "仅站内定位")
        self.assertFalse(opened)

    def test_incomplete_pagination_is_rejected(self):
        bundle = json.loads(FIXTURE.read_text(encoding="utf-8"))
        merged = {"n": 6, "end_cst": "2026-11-24 14:16:02", "results": bundle["pages"][0]["results"]}
        with self.assertRaises(nh.GateError) as merged_error:
            nh.seal_pages(merged)
        self.assertIn("合并结果", str(merged_error.exception))
        gap = json.loads(json.dumps(bundle))
        gap["pages"][1]["index"] = 3
        with self.assertRaises(nh.GateError) as gap_error:
            nh.seal_pages(gap)
        self.assertIn("不连续", str(gap_error.exception))
        hanging = json.loads(json.dumps(bundle))
        hanging["pages"][1]["has_more"] = True
        with self.assertRaises(nh.GateError) as hang_error:
            nh.seal_pages(hanging)
        self.assertIn("has_more", str(hang_error.exception))
        dup = json.loads(json.dumps(bundle))
        dup["pages"][1]["results"].append(dup["pages"][0]["results"][0])
        dup["pages"][1]["page_size"] = 3
        dup["declared_n"] = 7
        with self.assertRaises(nh.GateError) as dup_error:
            nh.seal_pages(dup)
        self.assertIn("重复", str(dup_error.exception))
        filtered = json.loads(json.dumps(bundle))
        filtered["query"]["archive_status"] = "active"
        with self.assertRaises(nh.GateError) as filter_error:
            nh.seal_pages(filtered)
        self.assertIn("archive_status", str(filter_error.exception))

    def test_feishu_matrix_is_not_a_snapshot(self):
        disguise = {"data": {"fields": ["原帖", "笔记标题"], "data": []}}
        with self.assertRaises(nh.GateError) as caught:
            nh.seal_pages(disguise)
        self.assertIn("飞书", str(caught.exception))

    def test_seal_dry_run_writes_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "snapshot.json"
            result = run([
                "scripts/notion-hotposts-snapshot.py", "seal",
                "--pages", str(FIXTURE), "--out", str(out), "--dry-run",
            ])
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse(out.exists())
            self.assertNotIn("SHOULD_NOT_LEAK", result.stdout)
            self.assertIn("rows_sha256", result.stdout)


class ImportUnion(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        bundle = json.loads(FIXTURE.read_text(encoding="utf-8"))
        self.snapshot = self.root / "snapshot.json"
        self.snapshot.write_text(json.dumps(nh.seal_pages(bundle), ensure_ascii=False), encoding="utf-8")
        self.scrub = self.root / "xhs-scrubbed.json"
        self.report = self.root / "scrub-report.json"
        scrubbed = run([
            "scripts/scrub-xhs.py", "--snapshot", str(self.snapshot),
            "--out", str(self.scrub), "--report", str(self.report),
        ])
        self.assertEqual(scrubbed.returncode, 0, scrubbed.stderr)
        self.assertNotIn("SHOULD_NOT_LEAK", scrubbed.stdout)
        self.assertNotIn("小明", scrubbed.stdout)
        scrub_body = self.scrub.read_text(encoding="utf-8")
        self.assertNotIn("小明", scrub_body)
        self.assertNotIn("Tom", scrub_body)
        self.assertNotIn("学军", scrub_body)
        self.assertNotIn("西湖实验", scrub_body)
        self.assertNotIn("不应出现的作者", scrub_body)
        self.assertNotIn("child-face", scrub_body)
        self.cn = self.root / "cn.json"
        self.cn.write_text(json.dumps({
            "items": [{
                "platform": "知乎",
                "url": ZHIHU_NEW,
                "title": "新的知乎帖",
                "summary": "只在收件箱",
                "发布日期": "2026-11-20",
                "采集日期": "2026-11-20",
            }]
        }, ensure_ascii=False), encoding="utf-8")
        self.baseline = self.root / "baseline.json"
        self.baseline.write_text(json.dumps({
            "generatedAt": "2026-11-24 13:14",
            "items": [
                {
                    "id": "baseline-conflict",
                    "platform": "X",
                    "url": CONFLICT,
                    "title": "谷歌为学生账号默认关闭 Gemini 和搜索",
                    "summary": "旧摘要",
                    "author": "@unusual_whales",
                    "published_at": "2026-11-04",
                    "day": "2026-11-04",
                    "verified": True,
                    "metrics": {"likes": 3185, "captured_at": "2026-11-01"},
                    "tags": {"topic": "待定", "subject": "待定", "companies": [], "form": "待定", "content_type": "用户自述"},
                },
                {
                    "id": "baseline-unverified",
                    "platform": "X",
                    "url": UNVERIFIED,
                    "title": "旧标题",
                    "day": "2026-10-15",
                    "published_at": "2026-10-15",
                    "verified": True,
                    "author": "",
                    "metrics": {},
                    "tags": {"topic": "待定", "content_type": "待定", "subject": "待定", "form": "待定", "companies": []},
                },
                {
                    "id": "baseline-xhs",
                    "platform": "小红书",
                    "url": XHS,
                    "title": "旧的小红书标题",
                    "author": "不应留下的作者",
                    "day": "2026-03-01",
                    "published_at": "2026-03-01",
                    "verified": True,
                    "metrics": {"likes": 9, "captured_at": "2020-01-01"},
                    "tags": {"topic": "教学实践", "content_type": "用户自述", "subject": "待定", "form": "待定", "companies": []},
                },
                {
                    "id": "baseline-missing",
                    "platform": "X",
                    "url": MISSING,
                    "title": "家长自述：三岁女儿要「Gem 先生」编睡前故事，随后又对音响下指令",
                    "day": "2026-10-17",
                    "published_at": "2026-10-17T08:10:22+08:00",
                    "verified": True,
                    "author": "@sohn522",
                    "metrics": {"likes": 9},
                    "tags": {"topic": "教学实践", "content_type": "用户自述", "subject": "待定", "form": "待定", "companies": []},
                },
                {
                    "id": "baseline-zhihu",
                    "platform": "知乎",
                    "url": ZHIHU_OLD,
                    "title": "只在站点里的知乎帖",
                    "day": "2026-11-01",
                    "published_at": "2026-11-01",
                    "verified": False,
                    "author": "",
                    "metrics": {},
                    "tags": {"topic": "待定", "content_type": "待定", "subject": "待定", "form": "待定", "companies": []},
                },
            ],
        }, ensure_ascii=False), encoding="utf-8")
        self.out = self.root / "voices.json"
        self.stamp = self.root / "import-stamp.json"
        self.import_report = self.root / "import-report.json"

    def tearDown(self):
        self.tmp.cleanup()

    def import_args(self, *extra):
        return [
            "scripts/import-voices.py",
            "--notion-snapshot", str(self.snapshot),
            "--baseline", str(self.baseline),
            "--cn", str(self.cn),
            "--scrubbed", str(self.scrub),
            "--out", str(self.out),
            "--report", str(self.import_report),
            "--stamp", str(self.stamp),
            *extra,
        ]

    def test_legacy_sources_do_not_write(self):
        feishu = self.root / "feishu-edu"
        feishu.mkdir()
        (feishu / "xhs-inbox.csv").write_text("原帖,笔记标题\n", encoding="utf-8")
        result = run(self.import_args("--x", str(GROK), "--xhs-dir", str(feishu), "--retain-baseline-union"))
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn("旧来源回退已禁用", result.stderr)
        self.assertFalse(self.out.exists())
        self.assertEqual(json.loads(self.stamp.read_text())["ok"], False)
        bare = run(["scripts/import-voices.py", "--stamp", str(self.root / "bare-stamp.json"), "--out", str(self.root / "bare.json")])
        self.assertEqual(bare.returncode, 2)
        self.assertIn("Notion 快照", bare.stderr)
        self.assertFalse((self.root / "bare.json").exists())
        feishu_sync = run(["scripts/sync-xhs-feishu.py"])
        self.assertEqual(feishu_sync.returncode, 2)
        self.assertIn("已停用", feishu_sync.stderr)
        self.assertFalse((feishu / "xhs-inbox.csv").read_text(encoding="utf-8").strip().endswith("http"))

    def test_without_retain_flag_refuses_and_blocks_sync(self):
        result = run(self.import_args())
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn("retain-baseline-union", result.stderr)
        self.assertFalse(self.out.exists())
        self.assertEqual(json.loads(self.stamp.read_text())["ok"], False)
        gate = run([
            "scripts/notion-hotposts-snapshot.py", "gate-sync",
            "--snapshot", str(self.snapshot), "--stamp", str(self.stamp),
        ])
        self.assertNotEqual(gate.returncode, 0)
        self.assertIn("SYNC GATE FAIL", gate.stderr)
        self.assertNotIn("postgres", gate.stderr.lower())

    def test_union_rerun_privacy_and_conflicts(self):
        dry = run(self.import_args("--retain-baseline-union", "--dry-run", "--skip-verify"))
        self.assertEqual(dry.returncode, 0, dry.stderr)
        self.assertFalse(self.out.exists())
        self.assertFalse(self.stamp.exists())
        self.assertNotIn("SHOULD_NOT_LEAK", dry.stdout)
        self.assertNotIn("小明", dry.stdout)
        first = run(self.import_args("--retain-baseline-union", "--skip-verify"))
        self.assertEqual(first.returncode, 0, first.stderr)
        stats = json.loads(first.stdout)
        self.assertEqual(stats["stats"]["duplicates"], 0)
        self.assertGreater(stats["stats"]["retained_baseline"], 0)
        self.assertGreater(stats["stats"]["added"], 0)
        self.assertGreater(stats["stats"]["changed"], 0)
        self.assertEqual(stats["verification"], "existing-card-not-lifted; new-post-uses-sheet")
        self.assertTrue(stats["skip_verify_ignored"])
        catalog = json.loads(self.out.read_text(encoding="utf-8"))
        blob = self.out.read_text(encoding="utf-8")
        self.assertNotIn("SHOULD_NOT_LEAK", blob)
        self.assertNotIn("xsec_token", blob)
        self.assertNotIn("小明", blob)
        self.assertNotIn("学军", blob)
        self.assertNotIn("不应出现的作者", blob)
        self.assertNotIn("不应留下的作者", blob)
        self.assertNotIn("child-face", blob)
        urls = [item["url"] for item in catalog["items"]]
        self.assertEqual(len(urls), len(set(urls)))
        self.assertIn(MISSING, urls)
        self.assertIn(NOTION_ONLY, urls)
        self.assertIn(EXISTING, urls)
        self.assertIn(ZHIHU_OLD, urls)
        self.assertIn(ZHIHU_NEW, urls)
        self.assertGreater(len(urls), 6)
        by_url = {item["url"]: item for item in catalog["items"]}
        privacy = by_url[PRIVACY]
        self.assertIsNone(privacy["day"])
        self.assertIsNone(privacy["published_at"])
        self.assertEqual(privacy["metrics"]["captured_at"], "2026-11-24")
        self.assertNotEqual(privacy["day"], privacy["metrics"]["captured_at"])
        self.assertFalse(privacy["verified"])
        self.assertEqual(privacy["author"], "")
        self.assertEqual(privacy["metrics"]["verification_status"], ["部分待核"])
        self.assertEqual(privacy["metrics"]["interaction_source"], "原帖底栏")
        self.assertIsNone(privacy["metrics"]["likes"])
        xhs = by_url[XHS]
        self.assertEqual(xhs["day"], "2026-03-01")
        self.assertEqual(xhs["metrics"]["captured_at"], "2026-11-24")
        self.assertNotEqual(xhs["day"], xhs["metrics"]["captured_at"])
        self.assertEqual(xhs["author"], "")
        self.assertEqual(xhs["tags"]["topic"], "教学实践")
        self.assertNotEqual(xhs["tags"]["topic"], "AI备课与课堂")
        self.assertEqual(xhs["tags"]["content_type"], "用户自述")
        conflict = by_url[CONFLICT]
        self.assertEqual(conflict["metrics"]["likes"], 3186)
        self.assertEqual(conflict["tags"]["content_type"], "用户自述")
        self.assertEqual(conflict["tags"]["topic"], "政策与合规")
        self.assertNotEqual(conflict["tags"]["content_type"], "新闻快讯")
        self.assertNotEqual(conflict["tags"]["content_type"], "行业资讯")
        unverified = by_url[UNVERIFIED]
        self.assertTrue(unverified["verified"])
        privacy_tags = privacy["tags"]
        self.assertEqual(privacy_tags["content_type"], "经验分享")
        self.assertEqual(privacy_tags["content_type_status"], "unmapped")
        reviews = {row["post_key"]: row for row in catalog["report"]["content_type_review"]}
        self.assertIsNone(reviews["x:2117738486036148624"]["site_content_type"])
        self.assertEqual(reviews["x:2117738486036148624"]["review"], "unreviewed")
        stamp = json.loads(self.stamp.read_text(encoding="utf-8"))
        self.assertTrue(stamp["ok"])
        gate = run([
            "scripts/notion-hotposts-snapshot.py", "gate-sync",
            "--snapshot", str(self.snapshot), "--stamp", str(self.stamp),
        ])
        self.assertEqual(gate.returncode, 0, gate.stderr)
        self.assertIn("SYNC GATE OK", gate.stdout)
        second_out = self.root / "voices-2.json"
        second_stamp = self.root / "stamp-2.json"
        second = run([
            "scripts/import-voices.py",
            "--notion-snapshot", str(self.snapshot),
            "--baseline", str(self.out),
            "--retain-baseline-union",
            "--cn", str(self.cn),
            "--scrubbed", str(self.scrub),
            "--out", str(second_out),
            "--stamp", str(second_stamp),
            "--skip-verify",
        ])
        self.assertEqual(second.returncode, 0, second.stderr)
        again = json.loads(second.stdout)["stats"]
        self.assertEqual(again["added"], 0)
        self.assertEqual(again["changed"], 0)
        self.assertEqual(again["duplicates"], 0)
        self.assertEqual(again["retained_baseline"], stats["stats"]["retained_baseline"])
        rerun = json.loads(second_out.read_text(encoding="utf-8"))
        self.assertEqual([item["url"] for item in rerun["items"]], urls)
        self.assertEqual(len(rerun["items"]), len({item["url"] for item in rerun["items"]}))


class ViewBodiesAndMerge(unittest.TestCase):
    def test_final_page_without_next_cursor_seals_and_cursor_conflict_fails(self):
        bundle = json.loads(FIXTURE.read_text(encoding="utf-8"))
        bodies = []
        for page in bundle["pages"]:
            body = {"results": page["results"], "has_more": page["has_more"]}
            if page["has_more"]:
                body["next_cursor"] = f"cursor-{page['index']}"
            bodies.append(body)
        provenance = {
            "data_source": nh.DATA_SOURCE,
            "database_url": nh.DATABASE_URL,
            "database_id": nh.DATABASE_ID,
            "view": nh.VIEW,
            "query": {"mode": "view", "archive_status": "all", "page_size": 4},
            "fetched_at": "2026-11-24T14:18:35+08:00",
            "requests": "reconstructed-not-original",
            "declared_n": 6,
            "pages": [
                {"page": 1, "reconstructed_request": {"data.start_cursor": None}},
                {"page": 2, "reconstructed_request": {"data.start_cursor": "cursor-1"}},
            ],
        }
        sealed = nh.seal_view_response_bodies(bodies, provenance)
        self.assertEqual(sealed["pagination"]["row_count"], 6)
        self.assertEqual(sealed["source"]["provenance"]["final_page_next_cursor"], "absent")
        self.assertEqual(sealed["source"]["provenance"]["requests"], "reconstructed-not-original")
        broken = json.loads(json.dumps(bodies))
        broken[-1]["next_cursor"] = "should-not-continue"
        with self.assertRaises(nh.GateError) as extra:
            nh.seal_view_response_bodies(broken, provenance)
        self.assertIn("next_cursor", str(extra.exception))
        mismatch = json.loads(json.dumps(provenance))
        mismatch["pages"][1]["reconstructed_request"]["data.start_cursor"] = "other"
        with self.assertRaises(nh.GateError) as conflict:
            nh.seal_view_response_bodies(bodies, mismatch)
        self.assertIn("start_cursor", str(conflict.exception))
        short = json.loads(json.dumps(bodies))
        short[0]["results"] = short[0]["results"][:2]
        with self.assertRaises(nh.GateError) as gap:
            nh.seal_view_response_bodies(short, provenance)
        self.assertIn("page_size", str(gap.exception))

    def test_older_notion_metrics_do_not_replace_baseline_and_verified_is_not_lifted(self):
        previous = {
            "platform": "X",
            "url": "https://x.com/a/status/1",
            "title": "站点标题",
            "summary": "站点上较长的摘要，不应被库存短句盖掉。",
            "day": "2026-11-04",
            "published_at": "2026-11-04T00:00:00+08:00",
            "verified": False,
            "author": "@a",
            "metrics": {"likes": 958, "captured_at": "2026-11-17T00:00:00+08:00", "views": 10},
            "tags": {"topic": "教学实践", "content_type": "观点评论", "subject": "待定", "form": "待定", "companies": []},
        }
        projected = {
            "platform": "X",
            "url": previous["url"],
            "title": "较短标题",
            "summary": "短",
            "day": "2026-11-04",
            "published_at": "2026-11-04",
            "verified": True,
            "author": "@other",
            "metrics": {"likes": 79, "captured_at": "2026-11-10", "interaction_source": "X 公开数据"},
            "tags": {"topic": "政策与合规", "content_type": "待定", "subject": "待定", "form": "待定", "companies": []},
        }
        notion = {"post_key": "x:1", "verified": True, "published_on": "2026-11-04", "captured_on": "2026-11-10", "notion_content_type": "行业资讯", "verification_status": ["原帖已核"]}
        merged, note = nh.merge_catalog_item(previous, projected, notion)
        self.assertEqual(merged["summary"], previous["summary"])
        self.assertEqual(merged["title"], previous["title"])
        self.assertEqual(merged["metrics"]["likes"], 958)
        self.assertEqual(merged["metrics"]["views"], 10)
        self.assertFalse(merged["verified"])
        self.assertEqual(note["verified"], "not-lifted")
        self.assertEqual(merged["tags"]["content_type"], "观点评论")
        self.assertEqual(merged["tags"]["topic"], "教学实践")
        fresh, fresh_note = nh.merge_catalog_item(None, projected, notion)
        self.assertEqual(fresh["tags"]["content_type"], "行业资讯")
        self.assertEqual(fresh["tags"]["content_type_status"], "unmapped")
        self.assertTrue(fresh["verified"])
        self.assertEqual(fresh_note["content_type"], "unmapped")


class RealFreeze(unittest.TestCase):
    def test_prewrite_freeze_is_not_importable_and_matches_known_counts(self):
        if not PREWRITE.exists() or not GROK.exists():
            self.skipTest("预写冻结不在这台机器上")
        import hashlib
        self.assertEqual(hashlib.sha256(PREWRITE.read_bytes()).hexdigest(), PREWRITE_SHA)
        self.assertEqual(hashlib.sha256(GROK.read_bytes()).hexdigest(), GROK_SHA)
        payload = json.loads(PREWRITE.read_text(encoding="utf-8"))
        with self.assertRaises(nh.GateError) as caught:
            nh.seal_pages(payload)
        self.assertIn("合并结果", str(caught.exception))
        rows = payload["results"]
        self.assertEqual(payload["n"], 541)
        self.assertEqual(len(rows), 541)
        platforms = {}
        keys = []
        missing_publish = {"X": 0, "小红书": 0}
        for row in rows:
            post = nh.normalize_connector_row(row)
            platforms[post["platform"]] = platforms.get(post["platform"], 0) + 1
            keys.append(post["post_key"])
            if post["published_on"] is None:
                missing_publish[post["platform"]] += 1
                self.assertNotEqual(post["captured_on"], post["published_on"])
            if post["published_on"]:
                self.assertNotEqual(post["published_on"], row.get("createdTime"))
            decided = nh.resolve_content_type(post["notion_content_type"])
            self.assertIsNone(decided["site_content_type"])
            if post["radar_content_type"]:
                self.assertNotEqual(decided["site_content_type"], post["radar_content_type"])
        self.assertEqual(platforms, {"小红书": 381, "X": 160})
        self.assertEqual(len(keys), len(set(keys)))
        self.assertEqual(missing_publish, {"X": 0, "小红书": 258})
        import re
        grok = json.loads(GROK.read_text(encoding="utf-8"))["posts"]
        grok_ids = set()
        for post in grok:
            match = re.search(r"/status/(\d+)", post.get("url") or "")
            if match:
                grok_ids.add(match.group(1))
        notion_ids = {key.split(":", 1)[1] for key in keys if key.startswith("x:")}
        self.assertEqual(len(grok_ids & notion_ids), 154)
        self.assertEqual(len(grok_ids - notion_ids), 276)
        self.assertEqual(len(notion_ids - grok_ids), 6)
        self.assertIn("2111248416340836468", grok_ids - notion_ids)
        self.assertIn("2077047278078931243", notion_ids - grok_ids)


if __name__ == "__main__":
    unittest.main()
