import { describe, expect, it, vi } from "vitest";
import {
  InsufficientDataError,
  ProviderAuthenticationError,
  ProviderError,
  ProviderNotFoundError,
  ProviderRateLimitError,
  ProviderTimeoutError,
} from "../../src/domain/errors";
import type {
  MarketDataProvider,
  MarketSeries,
  MarketSeriesRequest,
  ProviderRequestContext,
} from "../../src/domain/market-series";
import { FallbackProvider } from "../../src/providers/fallback";

const request: MarketSeriesRequest = {
  ticker: "AAPL",
  market: "stock",
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
  supports?: MarketDataProvider["supports"],
): MarketDataProvider {
  return supports === undefined
    ? { id, fetchSeries }
    : { id, fetchSeries, supports };
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
    new ProviderTimeoutError(),
    new ProviderAuthenticationError(undefined, { providerStatus: 401 }),
    new ProviderRateLimitError(),
    new InsufficientDataError(),
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

  it("skips providers that do not support the market without counting a failure", async () => {
    const warn = vi.fn();
    const unsupportedFetch = vi.fn(async () => series);
    const supportedFetch = vi.fn(async () => series);
    const chain = new FallbackProvider({
      providers: [
        provider("sifting", unsupportedFetch, (market) => market !== "index"),
        provider("lse", supportedFetch),
      ],
      logger: { info() {}, warn, error() {} },
    });

    await expect(
      chain.fetchSeries({ ...request, market: "index" }, context),
    ).resolves.toBe(series);
    expect(unsupportedFetch).not.toHaveBeenCalled();
    expect(supportedFetch).toHaveBeenCalledOnce();
    expect(warn).not.toHaveBeenCalled();
  });

  it("names the next supporting provider when falling back", async () => {
    const warn = vi.fn();
    const chain = new FallbackProvider({
      providers: [
        provider("first", async () => {
          throw new ProviderError(undefined, { providerStatus: 500 });
        }),
        provider(
          "unsupported",
          async () => series,
          () => false,
        ),
        provider("last", async () => series),
      ],
      logger: { info() {}, warn, error() {} },
    });

    await expect(chain.fetchSeries(request, context)).resolves.toBe(series);
    expect(warn).toHaveBeenCalledWith(
      "market_data_provider_fallback",
      expect.objectContaining({
        providerId: "first",
        fallbackProviderId: "last",
      }),
    );
  });

  it("reports not found when no configured provider supports the market", async () => {
    const chain = new FallbackProvider({
      providers: [
        provider(
          "sifting",
          async () => series,
          () => false,
        ),
      ],
      logger: { info() {}, warn() {}, error() {} },
    });
    await expect(chain.fetchSeries(request, context)).rejects.toBeInstanceOf(
      ProviderNotFoundError,
    );
  });
});
