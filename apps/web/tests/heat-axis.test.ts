import assert from "node:assert/strict";
import { test } from "node:test";
import { heatAxis } from "../app/features/story/heat-axis.ts";
import { formatHeat } from "../app/features/hot/presentation.ts";

test("every tick of every one-decimal peak from 0.1 to 100 reads exactly as its label", () => {
  const bad: string[] = [];
  for (let i = 1; i <= 1000; i++) {
    const peak = i / 10;
    const { ticks, top } = heatAxis(peak);
    const labels = ticks.map(formatHeat);
    if (ticks.some((t) => Number(formatHeat(t)) !== t)) bad.push(`${peak}: ${JSON.stringify(ticks)} -> ${JSON.stringify(labels)}`);
    if (top < peak) bad.push(`${peak}: top ${top} below the peak`);
    if (new Set(labels).size !== labels.length) bad.push(`${peak}: repeated labels ${JSON.stringify(labels)}`);
    if (ticks.length < 2 || ticks.length > 6) bad.push(`${peak}: ${ticks.length} ticks`);
  }
  assert.deepEqual(bad, []);
  assert.deepEqual(heatAxis(0.9).ticks, [0, 0.5, 1]);
  assert.deepEqual(heatAxis(1).ticks, [0, 0.5, 1]);
  assert.deepEqual(heatAxis(10).ticks, [0, 2.5, 5, 7.5, 10]); // 2.5× is fine from 1 up: 2.5 is one decimal
});

test("heat axis ticks carry no float noise and read as one-decimal labels", () => {
  for (const peak of [0.4, 0.7, 0.3, 1.3, 2.6, 7, 0.05, 37]) {
    const { ticks, top } = heatAxis(peak);
    assert.equal(ticks[0], 0);
    assert.equal(ticks.at(-1), top);
    assert.ok(top >= peak, `top ${top} covers peak ${peak}`);
    for (const v of ticks) assert.ok(String(v).length <= 5, `tick ${v} for peak ${peak}`);
    assert.equal(new Set(ticks).size, ticks.length);
    assert.equal(new Set(ticks.map(formatHeat)).size, ticks.length, `labels for peak ${peak} are distinct`);
    for (const t of ticks) assert.equal(Number(formatHeat(t)), t, `label of tick ${t} for peak ${peak}`);
  }
  assert.deepEqual(heatAxis(0.4).ticks, [0, 0.1, 0.2, 0.3, 0.4]);
  assert.deepEqual(heatAxis(0.7).ticks, [0, 0.2, 0.4, 0.6, 0.8]);
  assert.deepEqual(heatAxis(0.05).ticks, [0, 0.1]);
  assert.deepEqual(heatAxis(0.4).ticks.map(formatHeat), ["0", "0.1", "0.2", "0.3", "0.4"]);
  assert.deepEqual(heatAxis(0.7).ticks.map(formatHeat), ["0", "0.2", "0.4", "0.6", "0.8"]);
});
