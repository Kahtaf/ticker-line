import { describe, expect, it } from "vitest";
import {
  DEFAULT_SPARKLINE_OPTIONS,
  serializeCanonicalRequest,
  type CanonicalSparklineRequest,
} from "../../src/domain/request";
import { parseSparklineRequest } from "../../src/http/query";

describe("canonical request representation", () => {
  it("includes defaults in a fixed order", () => {
    const request: CanonicalSparklineRequest = {
      ticker: "AAPL",
      market: "stock",
      ...DEFAULT_SPARKLINE_OPTIONS,
    };
    expect(serializeCanonicalRequest(request)).toBe(
      "ticker=AAPL&market=stock&timeframe=1m&theme=light&fill=false&format=svg",
    );
  });

  it("percent-encodes values without changing field order", () => {
    expect(
      serializeCanonicalRequest({
        ticker: "BTC/USD",
        market: "crypto",
        timeframe: "7d",
        theme: "dark",
        fill: true,
        format: "json",
      }),
    ).toBe(
      "ticker=BTC%2FUSD&market=crypto&timeframe=7d&theme=dark&fill=true&format=json",
    );
  });

  it("accepts provider slash symbols inside the ticker query value", () => {
    expect(
      parseSparklineRequest(
        new Request(
          "https://example.test/v1/sparkline?ticker=xau%2Fusd&market=commodity",
        ),
      ).ticker,
    ).toBe("XAU/USD");
  });

  it("requires a supported market", () => {
    expect(() =>
      parseSparklineRequest(
        new Request("https://example.test/v1/sparkline?ticker=AAPL"),
      ),
    ).toThrow(
      "Parameter 'market' is required. Use one of: stock, crypto, forex, commodity, index.",
    );
    expect(() =>
      parseSparklineRequest(
        new Request(
          "https://example.test/v1/sparkline?ticker=AAPL&market=equity",
        ),
      ),
    ).toThrow(
      "Parameter 'market' must be one of: stock, crypto, forex, commodity, index.",
    );
  });

  it("parses the fill flag and defaults it off", () => {
    expect(
      parseSparklineRequest(
        new Request(
          "https://example.test/v1/sparkline?ticker=AAPL&market=stock",
        ),
      ).fill,
    ).toBe(false);
    expect(
      parseSparklineRequest(
        new Request(
          "https://example.test/v1/sparkline?ticker=AAPL&market=stock&fill=true",
        ),
      ).fill,
    ).toBe(true);
  });

  it("rejects the removed color option and non-boolean fills", () => {
    expect(() =>
      parseSparklineRequest(
        new Request(
          "https://example.test/v1/sparkline?ticker=AAPL&market=stock&color=blue",
        ),
      ),
    ).toThrow("Unknown parameter 'color'.");
    expect(() =>
      parseSparklineRequest(
        new Request(
          "https://example.test/v1/sparkline?ticker=AAPL&market=stock&fill=1",
        ),
      ),
    ).toThrow("Parameter 'fill' has an unsupported value.");
  });
});
