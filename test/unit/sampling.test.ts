import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { MarketPoint } from "../../src/domain/market-series";
import { sampleMarketPoints } from "../../src/render/sampling";

describe("min/max sampling", () => {
  it("preserves short inputs byte-for-point", () => {
    const points = [
      { timestamp: 1, close: 2 },
      { timestamp: 2, close: 3 },
    ] as const;
    expect(sampleMarketPoints(points)).toEqual(points);
    expect(sampleMarketPoints(points)).not.toBe(points);
  });

  it("preserves endpoints and global extrema", () => {
    const points = Array.from({ length: 1_000 }, (_, index): MarketPoint => ({
      timestamp: index,
      close: index === 432 ? -10_000 : index === 678 ? 10_000 : Math.sin(index),
    }));
    const sampled = sampleMarketPoints(points, 40);
    expect(sampled).toHaveLength(40);
    expect(sampled[0]).toBe(points[0]);
    expect(sampled.at(-1)).toBe(points.at(-1));
    expect(sampled).toContain(points[432]);
    expect(sampled).toContain(points[678]);
  });

  it("always returns a sorted, bounded subset", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ noNaN: true, noDefaultInfinity: true }), {
          minLength: 4,
          maxLength: 600,
        }),
        fc.integer({ min: 4, max: 250 }),
        (values, maximum) => {
          const points = values.map((close, timestamp) => ({
            timestamp,
            close,
          }));
          const output = sampleMarketPoints(points, maximum);
          expect(output.length).toBeLessThanOrEqual(maximum);
          expect(output.every((point) => points.includes(point))).toBe(true);
          expect(
            output.every(
              (point, index) =>
                index === 0 || point.timestamp > output[index - 1]!.timestamp,
            ),
          ).toBe(true);
        },
      ),
    );
  });
});
