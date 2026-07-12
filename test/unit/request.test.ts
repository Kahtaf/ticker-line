import { describe, expect, it } from "vitest";
import {
  DEFAULT_SPARKLINE_OPTIONS,
  serializeCanonicalRequest,
  type CanonicalSparklineRequest,
} from "../../src/domain/request";

describe("canonical request representation", () => {
  it("includes defaults in a fixed order", () => {
    const request: CanonicalSparklineRequest = {
      ticker: "AAPL",
      ...DEFAULT_SPARKLINE_OPTIONS,
    };
    expect(serializeCanonicalRequest(request)).toBe(
      "ticker=AAPL&timeframe=1m&theme=light&color=auto&format=svg",
    );
  });

  it("percent-encodes values without changing field order", () => {
    expect(
      serializeCanonicalRequest({
        ticker: "BTC/USD",
        timeframe: "7d",
        theme: "dark",
        color: "blue",
        format: "json",
      }),
    ).toBe("ticker=BTC%2FUSD&timeframe=7d&theme=dark&color=blue&format=json");
  });
});
