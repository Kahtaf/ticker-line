import type { MarketPoint } from "../domain/market-series";

export const MAX_RENDER_POINTS = 250;

function extremaIndexes(
  points: readonly MarketPoint[],
): Readonly<{ min: number; max: number }> {
  let min = 0;
  let max = 0;
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index];
    if (point === undefined) continue;
    if (point.close < (points[min]?.close ?? Infinity)) min = index;
    if (point.close > (points[max]?.close ?? -Infinity)) max = index;
  }
  return { min, max };
}

/** Deterministic min/max bucket sampling. Input is expected in chronological order. */
export function sampleMarketPoints(
  points: readonly MarketPoint[],
  maximum = MAX_RENDER_POINTS,
): readonly MarketPoint[] {
  if (!Number.isInteger(maximum) || maximum < 4) {
    throw new RangeError(
      "Sampling maximum must be an integer of at least four.",
    );
  }
  if (points.length <= maximum) return points.slice();

  const mandatory = extremaIndexes(points);
  const selected = new Set<number>([
    0,
    points.length - 1,
    mandatory.min,
    mandatory.max,
  ]);
  const interiorCapacity = maximum - 2;
  const bucketCount = Math.max(1, Math.floor(interiorCapacity / 2));
  const interiorLength = points.length - 2;

  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const start = 1 + Math.floor((bucket * interiorLength) / bucketCount);
    const end = 1 + Math.floor(((bucket + 1) * interiorLength) / bucketCount);
    let minIndex = start;
    let maxIndex = start;
    for (let index = start + 1; index < end; index += 1) {
      const point = points[index];
      if (point === undefined) continue;
      if (point.close < (points[minIndex]?.close ?? Infinity)) minIndex = index;
      if (point.close > (points[maxIndex]?.close ?? -Infinity))
        maxIndex = index;
    }
    selected.add(minIndex);
    selected.add(maxIndex);
  }

  if (selected.size > maximum) {
    const removable = [...selected]
      .filter(
        (index) =>
          index !== 0 &&
          index !== points.length - 1 &&
          index !== mandatory.min &&
          index !== mandatory.max,
      )
      .sort((a, b) => b - a);
    while (selected.size > maximum) {
      const index = removable.shift();
      if (index === undefined) break;
      selected.delete(index);
    }
  }

  return [...selected]
    .sort((a, b) => a - b)
    .map((index) => points[index])
    .filter((point): point is MarketPoint => point !== undefined);
}
