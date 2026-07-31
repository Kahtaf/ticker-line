import { describe, expect, it, vi } from "vitest";
import { ProviderError, ProviderNotFoundError } from "../../src/domain/errors";
import type {
  MarketDataProvider,
  MarketSeries,
  MarketSeriesRequest,
  ProviderRequestContext,
} from "../../src/domain/market-series";
import { FallbackProvider } from "../../src/providers/fallback";

const request: MarketSeriesRequest = {
  ticker: "AAPL",
  start: new Date("2026-07-01T00:00:00Z"),
  end: new Date("2026-07-31T00:00:00Z"),
  interval: "1d",
};
const context: ProviderRequestContext = {
  requestId: "request-1",
  signal: new AbortController().signal,
};
const series: MarketSeries = {
  resolvedTicker: "AAPL",
  assetType: "stock",
  dataAsOf: "2026-07-30T00:00:00.000Z",
  referenceClose: 100,
  points: [{ timestamp: Date.parse("2026-07-30T00:00:00.000Z"), close: 100 }],
};

function provider(
  id: string,
  fetchSeries: MarketDataProvider["fetchSeries"],
): MarketDataProvider {
  return { id, fetchSeries };
}

describe("FallbackProvider", () => {
  it("returns the primary result without calling the fallback", async () => {
    const primaryFetch = vi.fn(async () => series);
    const fallbackFetch = vi.fn(async () => series);
    const chain = new FallbackProvider({
      providers: [
        provider("sifting", primaryFetch),
        provider("lse", fallbackFetch),
      ],
      logger: { info() {}, warn() {}, error() {} },
    });

    await expect(chain.fetchSeries(request, context)).resolves.toBe(series);
    expect(primaryFetch).toHaveBeenCalledOnce();
    expect(fallbackFetch).not.toHaveBeenCalled();
    expect(chain.id).toBe("sifting-lse");
  });

  it.each([
    new ProviderNotFoundError(),
    new ProviderError(undefined, { providerStatus: 503, attempt: 2 }),
  ])("falls back after a provider-domain failure", async (failure) => {
    const warn = vi.fn();
    const fallbackFetch = vi.fn(async () => series);
    const chain = new FallbackProvider({
      providers: [
        provider("sifting", async () => Promise.reject(failure)),
        provider("lse", fallbackFetch),
      ],
      logger: { info() {}, warn, error() {} },
    });

    await expect(chain.fetchSeries(request, context)).resolves.toBe(series);
    expect(fallbackFetch).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      "market_data_provider_fallback",
      expect.objectContaining({
        requestId: "request-1",
        providerId: "sifting",
        fallbackProviderId: "lse",
        ticker: "AAPL",
      }),
    );
  });

  it("returns the final provider failure when the chain is exhausted", async () => {
    const chain = new FallbackProvider({
      providers: [
        provider("sifting", async () => {
          throw new ProviderNotFoundError();
        }),
        provider("lse", async () => {
          throw new ProviderError(undefined, { providerStatus: 502 });
        }),
      ],
      logger: { info() {}, warn() {}, error() {} },
    });
    await expect(chain.fetchSeries(request, context)).rejects.toMatchObject({
      providerStatus: 502,
    });
  });
});
