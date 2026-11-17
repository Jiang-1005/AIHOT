/** Y axis of the story heat chart: a nice step for at most ~4 intervals, ticks from 0 to the first step at or above the peak. */

function niceStep(max: number): number {
  const raw = max / 4;
  const pow = 10 ** Math.floor(Math.log10(raw || 1));
  return ([1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw) || 1;
}

/** Rounded to 1e-6 so i × step never leaks float noise (0.1 × 3 = 0.30000000000000004) into labels or keys. */
const clean = (n: number) => Math.round(n * 1e6) / 1e6;

/** Labels are one decimal (formatHeat), so a finer step would print the same label twice (0.025 and 0.05 both read 「0.1」/「0」). */
const MIN_STEP = 0.1;

export function heatAxis(peak: number): { step: number; top: number; ticks: number[] } {
  const step = clean(Math.max(MIN_STEP, niceStep(peak)));
  const top = clean(Math.max(step, Math.ceil(clean(peak / step)) * step));
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => clean(i * step));
  return { step, top, ticks };
}
