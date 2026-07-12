import { describe, expect, it } from "vitest";
import {
  getTimeframePolicy,
  getTimeframeRange,
} from "../../src/domain/timeframe";

describe("timeframe policy", () => {
  it("maps public ranges to bounded provider intervals", () => {
    expect(getTimeframePolicy("1d")).toEqual({
      interval: "15m",
      targetPoints: 128,
    });
    expect(getTimeframePolicy("7d").interval).toBe("1h");
    expect(getTimeframePolicy("1m").interval).toBe("1d");
    expect(getTimeframePolicy("3m").interval).toBe("1d");
    expect(getTimeframePolicy("1y").targetPoints).toBe(250);
    expect(getTimeframePolicy("5y")).toEqual({
      interval: "1w",
      targetPoints: 250,
    });
  });

  it("uses UTC calendar ranges and clamps month ends", () => {
    const end = new Date("2024-03-31T14:30:00.000Z");
    expect(getTimeframeRange("1m", end).start.toISOString()).toBe(
      "2024-02-29T14:30:00.000Z",
    );
    expect(
      getTimeframeRange(
        "1y",
        new Date("2024-02-29T12:00:00Z"),
      ).start.toISOString(),
    ).toBe("2023-02-28T12:00:00.000Z");
    expect(getTimeframeRange("1d", end).end).not.toBe(end);
  });

  it("rejects an invalid end date", () => {
    expect(() => getTimeframeRange("1m", new Date(Number.NaN))).toThrow(
      TypeError,
    );
  });
});
