import { describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app";
import {
  MarketDataCache,
  type MarketDataKvStore,
} from "../../src/cache/data-cache";
import {
  ProviderAuthenticationError,
  ProviderError,
  ProviderNotFoundError,
  ProviderRateLimitError,
  toPublicError,
} from "../../src/domain/errors";
import type {
  MarketDataProvider,
  MarketSeriesRequest,
} from "../../src/domain/market-series";
import { FallbackProvider } from "../../src/providers/fallback";

class MemoryKv implements MarketDataKvStore {
  readonly values = new Map<string, string>();
  async get(key: string, _type: "json"): Promise<unknown> {
    const value = this.values.get(key);
    return value === undefined ? null : JSON.parse(value);
  }
  async put(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }
}

const indexRequest: MarketSeriesRequest = {
  ticker: "NAS100/USD",
  market: "index",
  start: new Date("2026-07-01T00:00:00Z"),
  end: new Date("2026-07-31T00:00:00Z"),
  interval: "1d",
};
const context = {
  requestId: "request-1",
  signal: new AbortController().signal,
};

function failing(id: string, error: Error): MarketDataProvider {
  return {
    id,
    async fetchSeries() {
      throw error;
    },
  };
}

const lseAuthFailure = (): ProviderAuthenticationError =>
  new ProviderAuthenticationError(undefined, { providerStatus: 401 });

describe("provider authentication failures", () => {
  it("maps to a non-retryable 503 instead of a retryable 502", () => {
    const publicError = toPublicError(lseAuthFailure());
    expect(publicError).toEqual({
      code: "SERVICE_UNAVAILABLE",
      status: 503,
      message: "Market data is currently unavailable.",
    });
    expect(publicError).not.toHaveProperty("retryAfterSeconds");
  });

  it("logs the provider and upstream status without secrets", async () => {
    const error = vi.fn();
    const chain = new FallbackProvider({
      providers: [
        failing("sifting", new ProviderNotFoundError()),
        failing("lse", lseAuthFailure()),
      ],
      logger: { info() {}, warn() {}, error },
    });

    await expect(chain.fetchSeries(indexRequest, context)).rejects.toThrow(
      ProviderAuthenticationError,
    );
    expect(error).toHaveBeenCalledWith("market_data_provider_auth_failed", {
      requestId: "request-1",
      providerId: "lse",
      providerStatus: 401,
      ticker: "NAS100/USD",
      market: "index",
    });
  });

  it("surfaces an earlier auth failure over a later not-found", async () => {
    const chain = new FallbackProvider({
      providers: [
        failing("lse", lseAuthFailure()),
        failing("sifting", new ProviderNotFoundError()),
      ],
      logger: { info() {}, warn() {}, error() {} },
    });

    await expect(
      chain.fetchSeries({ ...indexRequest, market: "stock" }, context),
    ).rejects.toThrow(ProviderAuthenticationError);
  });

  it("keeps a later transient failure retryable", async () => {
    const chain = new FallbackProvider({
      providers: [
        failing("lse", lseAuthFailure()),
        failing(
          "sifting",
          new ProviderError(undefined, { providerStatus: 502 }),
        ),
      ],
      logger: { info() {}, warn() {}, error() {} },
    });

    const failure = chain.fetchSeries(
      { ...indexRequest, market: "stock" },
      context,
    );
    await expect(failure).rejects.toMatchObject({ providerStatus: 502 });
    await expect(failure).rejects.not.toBeInstanceOf(
      ProviderAuthenticationError,
    );
  });

  it("keeps a later rate limit retryable", async () => {
    const rateLimit = new ProviderRateLimitError(undefined, {
      retryAfterSeconds: 30,
    });
    const chain = new FallbackProvider({
      providers: [
        failing("lse", lseAuthFailure()),
        failing("sifting", rateLimit),
      ],
      logger: { info() {}, warn() {}, error() {} },
    });

    await expect(
      chain.fetchSeries({ ...indexRequest, market: "stock" }, context),
    ).rejects.toBe(rateLimit);
  });

  it("returns a later 5xx after an auth failure and an intermediate not-found", async () => {
    const serverError = new ProviderError(undefined, { providerStatus: 503 });
    const chain = new FallbackProvider({
      providers: [
        failing("lse", lseAuthFailure()),
        failing("middle", new ProviderNotFoundError()),
        failing("sifting", serverError),
      ],
      logger: { info() {}, warn() {}, error() {} },
    });

    await expect(
      chain.fetchSeries({ ...indexRequest, market: "stock" }, context),
    ).rejects.toBe(serverError);
  });

  it("logs a distinct event when provider configuration is invalid", async () => {
    const error = vi.fn();
    const createProvider = vi.fn();
    const app = createApp({
      logger: { info() {}, warn() {}, error },
      createProvider,
      createDataCache: () => new MarketDataCache(new MemoryKv()),
      createStatusStore: () => ({
        async read() {
          return undefined;
        },
        async recordMarketData() {},
      }),
    });
    const allow = { limit: async () => ({ success: true }) };
    const env = {
      APP_ENV: "staging",
      PROVIDER_ORDER: "sifting,lse",
      PROVIDER_VERSION: "v1",
      SIFTING_BASE_URL: "https://sifting.example.test",
      LSE_BASE_URL: "https://lse.example.test",
      CACHE_POLICY_VERSION: "v1",
      NORMALIZATION_VERSION: "config-error-test",
      RENDERER_VERSION: "config-error-test",
      SIFTING_API_KEY: "fixture-sifting-key",
      LSE_API_KEY: "",
      SPARKLINE_BURST_RATE_LIMITER: allow,
      SPARKLINE_RATE_LIMITER: allow,
    } as unknown as Env;
    const executionCtx = {
      waitUntil() {},
      passThroughOnException() {},
      props: {},
    } as unknown as ExecutionContext;

    const response = await app.request(
      "https://ticker-line.test/v1/sparkline?ticker=AAPL&market=stock&timeframe=1m&format=json",
      {},
      env,
      executionCtx,
    );

    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(createProvider).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      "provider_configuration_invalid",
      expect.objectContaining({
        errorType: "ProviderConfigurationError",
        errorMessage: expect.stringContaining("LSE_API_KEY") as unknown,
      }),
    );
    const logged = JSON.stringify(error.mock.calls);
    expect(logged).not.toContain("fixture-sifting-key");
  });

  it("returns 503 JSON for an index when Sifting is not found and LSE returns 401", async () => {
    const app = createApp({
      logger: { info() {}, warn() {}, error() {} },
      createProvider: () =>
        new FallbackProvider({
          providers: [
            failing("sifting", new ProviderNotFoundError()),
            failing("lse", lseAuthFailure()),
          ],
          logger: { info() {}, warn() {}, error() {} },
        }),
      createDataCache: () => new MarketDataCache(new MemoryKv()),
      createStatusStore: () => ({
        async read() {
          return undefined;
        },
        async recordMarketData() {},
      }),
    });
    const allow = { limit: async () => ({ success: true }) };
    const env = {
      APP_ENV: "staging",
      PROVIDER_ORDER: "sifting,lse",
      PROVIDER_VERSION: "v1",
      SIFTING_BASE_URL: "https://sifting.example.test",
      LSE_BASE_URL: "https://lse.example.test",
      CACHE_POLICY_VERSION: "v1",
      NORMALIZATION_VERSION: "auth-failure-test",
      RENDERER_VERSION: "auth-failure-test",
      SIFTING_API_KEY: "fixture-sifting-key",
      LSE_API_KEY: "fixture-lse-key",
      SPARKLINE_BURST_RATE_LIMITER: allow,
      SPARKLINE_RATE_LIMITER: allow,
    } as unknown as Env;
    const executionCtx = {
      waitUntil() {},
      passThroughOnException() {},
      props: {},
    } as unknown as ExecutionContext;

    const response = await app.request(
      "https://ticker-line.test/v1/sparkline?ticker=NAS100%2FUSD&market=index&timeframe=1m&format=json",
      {},
      env,
      executionCtx,
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBeNull();
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "SERVICE_UNAVAILABLE",
        message: "Market data is currently unavailable.",
      },
    });
  });
});
