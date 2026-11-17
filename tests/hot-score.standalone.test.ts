import assert from "node:assert/strict";
import { test } from "node:test";
import { engagementFromRaw, hotRankingMode, hotRuleVersion, rankingHeatIndex, rankingScore } from "@aihot/backend/events/hot";

test("rankingScore: one source, no engagement, T=0 is 28.7 on the published index", () => {
  assert.equal(rankingHeatIndex(rankingScore(1, 0, 0)), 28.7);
});

test("rankingScore: more sources rank higher at the same engagement and age", () => {
  assert.ok(rankingScore(2, 0, 0) > rankingScore(1, 0, 0));
  assert.ok(rankingScore(3, 8, 12) > rankingScore(2, 8, 12));
});

test("rankingScore: later evidence ranks higher, same sources", () => {
  assert.ok(rankingScore(1, 0, 1) > rankingScore(1, 0, 24));
});

test("rankingHeatIndex rounds to one decimal of thousandths", () => {
  assert.equal(rankingHeatIndex(0.00765), 0.8);
  assert.equal(rankingHeatIndex(0.00137), 0.1);
});

test("engagementFromRaw reads favorite, retweet and like counts; x_post itself has none", () => {
  assert.equal(engagementFromRaw(null), 0);
  assert.equal(engagementFromRaw({ favorite_count: 10, retweet_count: 3, views: 100 }), 13);
  assert.equal(engagementFromRaw({ like_count: 4, reply_count: 1 }), 5);
  assert.equal(engagementFromRaw({ text: "a post" }), 0);
});

test("hotRankingMode follows HOT_RANKING_MODE and defaults to heat", () => {
  const prev = process.env.HOT_RANKING_MODE;
  try {
    delete process.env.HOT_RANKING_MODE;
    assert.equal(hotRankingMode(), "heat");
    assert.equal(hotRuleVersion(), "heat-v2-hn-score-48h");
    process.env.HOT_RANKING_MODE = "threshold";
    assert.equal(hotRankingMode(), "threshold");
    assert.equal(hotRuleVersion(), "heat-v2-threshold-48h");
    process.env.HOT_RANKING_MODE = "heat";
    assert.equal(hotRankingMode(), "heat");
  } finally {
    if (prev === undefined) delete process.env.HOT_RANKING_MODE;
    else process.env.HOT_RANKING_MODE = prev;
  }
});
