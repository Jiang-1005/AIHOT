import assert from "node:assert/strict";
import { test } from "node:test";
import { heatAxis } from "../app/features/story/heat-axis.ts";
import { formatHeat } from "../app/features/hot/presentation.ts";

test("heat axis ticks carry no float noise and read as one-decimal labels", () => {
  for (const peak of [0.4, 0.7, 0.3, 1.3, 2.6, 7, 0.05, 37]) {
    const { ticks, top } = heatAxis(peak);
    assert.equal(ticks[0], 0);
    assert.equal(ticks.at(-1), top);
    assert.ok(top >= peak, `top ${top} covers peak ${peak}`);
    for (const v of ticks) assert.ok(String(v).length <= 5, `tick ${v} for peak ${peak}`);
    assert.equal(new Set(ticks).size, ticks.length);
    assert.equal(new Set(ticks.map(formatHeat)).size, ticks.length, `labels for peak ${peak} are distinct`);
  }
  assert.deepEqual(heatAxis(0.4).ticks, [0, 0.1, 0.2, 0.3, 0.4]);
  assert.deepEqual(heatAxis(0.7).ticks, [0, 0.2, 0.4, 0.6, 0.8]);
  assert.deepEqual(heatAxis(0.05).ticks, [0, 0.1]);
  assert.deepEqual(heatAxis(0.4).ticks.map(formatHeat), ["0", "0.1", "0.2", "0.3", "0.4"]);
  assert.deepEqual(heatAxis(0.7).ticks.map(formatHeat), ["0", "0.2", "0.4", "0.6", "0.8"]);
});
