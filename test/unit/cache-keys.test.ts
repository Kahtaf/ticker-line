import { describe, expect, it } from "vitest";
import {
  createDataCacheKey,
  createFallbackCacheKey,
  createResponseCacheKey,
} from "../../src/cache/keys";

describe("cache keys", () => {
  it("creates stable data keys without rolling timestamps", () => {
    expect(
      createDataCacheKey({
        cachePolicyVersion: "v1",
        providerId: "lse",
        providerVersion: "v1",
        normalizationVersion: "v1",
        ticker: "BTC-USD",
        timeframe: "1m",
        interval: "1d",
      }),
    ).toBe("market-data:v1:lse:v1:v1:BTC-USD:1m:1d");
  });

  it("orders every generated-response variant explicitly", () => {
    const key = createResponseCacheKey(
      {
        ticker: "AAPL",
        timeframe: "1m",
        theme: "light",
        color: "auto",
        format: "svg",
      },
      { rendererVersion: "v1", normalizationVersion: "v1" },
    );
    expect(key.url).toBe(
      "https://cache.internal/render/v1/v1?ticker=AAPL&timeframe=1m&theme=light&color=auto&format=svg",
    );
  });

  it("keys fallback artifacts only by version and public error code", () => {
    expect(createFallbackCacheKey("TICKER_NOT_FOUND", "v1").url).toBe(
      "https://cache.internal/fallback/v1/TICKER_NOT_FOUND",
    );
  });
});
