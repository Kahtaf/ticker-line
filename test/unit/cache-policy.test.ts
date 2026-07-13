import { describe, expect, it } from "vitest";
import { defaultFreshnessPolicy } from "../../src/cache/policy";

describe("defaultFreshnessPolicy", () => {
  it.each([
    ["1d", 1_500, 3_600],
    ["7d", 6_000, 21_600],
    ["1m", 18_000, 86_400],
    ["3m", 36_000, 86_400],
    ["1y", 72_000, 259_200],
    ["5y", 432_000, 604_800],
  ] as const)(
    "uses the configured %s active policy",
    (timeframe, fresh, stale) => {
      expect(
        defaultFreshnessPolicy.evaluate({ timeframe, assetType: "unknown" }),
      ).toMatchObject({
        freshForSeconds: fresh,
        staleForSeconds: stale,
        browserMaxAgeSeconds: 60,
      });
    },
  );

  it("uses trusted next-update metadata for a closed exchange-listed asset", () => {
    const now = new Date("2026-07-12T12:00:00.000Z");
    const next = new Date("2026-07-13T13:30:00.000Z");
    expect(
      defaultFreshnessPolicy.evaluate({
        timeframe: "1d",
        assetType: "stock",
        marketState: "closed",
        nextMeaningfulUpdate: next,
        now,
      }),
    ).toMatchObject({
      freshForSeconds: 91_860,
      reason: "1d-trusted-next-market-update",
    });
  });
});
