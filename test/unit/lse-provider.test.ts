import { describe, expect, it, vi } from "vitest";
import {
  InsufficientDataError,
  ProviderAuthenticationError,
  ProviderError,
  ProviderNotFoundError,
  ProviderRateLimitError,
  ProviderSchemaError,
  ProviderTimeoutError,
} from "../../src/domain/errors";
import type { MarketSeriesRequest } from "../../src/domain/market-series";
import {
  LseProvider,
  parseLseUtcTimestamp,
  readBoundedBody,
} from "../../src/providers/lse/adapter";
import aapl from "../fixtures/provider/lse-aapl.json";
import btc from "../fixtures/provider/lse-btc.json";
import empty from "../fixtures/provider/lse-empty.json";
import vod from "../fixtures/provider/lse-vod-l.json";

const baseRequest: MarketSeriesRequest = {
  ticker: "AAPL",
  start: new Date("2026-07-01T00:00:00.000Z"),
  end: new Date("2026-07-12T00:00:00.000Z"),
  interval: "1d",
};

const context = {
  requestId: "request-1",
  signal: new AbortController().signal,
};

function providerWith(
  response: Response,
  inspect?: (request: Request) => void,
): LseProvider {
  const providerFetch: typeof fetch = (input) => {
    inspect?.(new Request(input));
    return Promise.resolve(response);
  };
  return new LseProvider({
    apiKey: "fixture-key",
    maxAttempts: 1,
    fetch: vi.fn(providerFetch),
  });
}

describe("LseProvider", () => {
  it("normalizes rows and derives dataAsOf from the preserved final candle", async () => {
    const series = await providerWith(Response.json(aapl)).fetchSeries(
      baseRequest,
      context,
    );
    expect(series).toEqual({
      resolvedTicker: "AAPL",
      assetType: "unknown",
      dataAsOf: "2026-07-11T20:00:00.000Z",
      points: [
        { timestamp: Date.UTC(2026, 6, 10, 20), close: 211.25 },
        { timestamp: Date.UTC(2026, 6, 11, 20), close: 213.5 },
      ],
    });
  });

  it("maps BTC-USD only at the provider boundary and preserves provisional precision", async () => {
    let requestedUrl: URL | undefined;
    const series = await providerWith(Response.json(btc), (request) => {
      requestedUrl = new URL(request.url);
    }).fetchSeries(
      { ...baseRequest, ticker: "BTC-USD", interval: "15m" },
      context,
    );
    expect(requestedUrl?.searchParams.get("symbol")).toBe("BTC/USD");
    expect(requestedUrl?.searchParams.get("start")).toBe("2026-07-01");
    expect(requestedUrl?.searchParams.get("end")).toBe("2026-07-12");
    expect(requestedUrl?.pathname).toBe("/vault/candles");
    expect(series.resolvedTicker).toBe("BTC-USD");
    expect(series.assetType).toBe("crypto");
    expect(series.currency).toBe("USD");
    expect(series.dataAsOf).toBe("2026-07-12T20:30:00.123Z");
  });

  it.each([
    ["ETH-USD", "ETH/USD", "crypto"],
    ["SOL-USD", "SOL/USD", "crypto"],
    ["EURUSD=X", "EUR/USD", "forex"],
    ["^GSPC", "SPX500/USD", "index"],
    ["^DJI", "US30/USD", "index"],
    ["^IXIC", "NASCOMP/USD", "index"],
    ["^RUT", "US2000/USD", "index"],
  ] as const)(
    "maps public ticker %s to provider symbol %s",
    async (ticker, providerSymbol, assetType) => {
      let symbol: string | null = null;
      const rows = btc.map((row) => ({ ...row, symbol: providerSymbol }));
      const series = await providerWith(Response.json(rows), (request) => {
        symbol = new URL(request.url).searchParams.get("symbol");
      }).fetchSeries({ ...baseRequest, ticker }, context);

      expect(symbol).toBe(providerSymbol);
      expect(series.resolvedTicker).toBe(ticker);
      expect(series.assetType).toBe(assetType);
      expect(series.currency).toBe("USD");
    },
  );

  it("preserves exact exchange suffixes", async () => {
    let symbol: string | null = null;
    await providerWith(Response.json(vod), (request) => {
      symbol = new URL(request.url).searchParams.get("symbol");
    }).fetchSeries({ ...baseRequest, ticker: "VOD.L" }, context);
    expect(symbol).toBe("VOD.L");
  });

  it("sorts and deterministically keeps the final duplicate timestamp", async () => {
    const rows = [aapl[1], { ...aapl[0], close: 1 }, { ...aapl[0], close: 2 }];
    const series = await providerWith(Response.json(rows)).fetchSeries(
      baseRequest,
      context,
    );
    expect(series.points.map((point) => point.close)).toEqual([2, 213.5]);
  });

  it.each([
    [401, ProviderAuthenticationError],
    [403, ProviderAuthenticationError],
    [404, ProviderNotFoundError],
    [422, ProviderSchemaError],
  ] as const)(
    "maps provider status %s before reading its body",
    async (status, ErrorClass) => {
      const response = new Response("{ definitely not json", { status });
      await expect(
        providerWith(response).fetchSeries(baseRequest, context),
      ).rejects.toBeInstanceOf(ErrorClass);
    },
  );

  it("maps 429 and retains Retry-After without parsing provider detail", async () => {
    const error = await providerWith(
      new Response("{ nested: nonsense", {
        status: 429,
        headers: { "Retry-After": "12" },
      }),
    )
      .fetchSeries(baseRequest, context)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProviderRateLimitError);
    expect((error as ProviderRateLimitError).retryAfterSeconds).toBe(12);
  });

  it("treats a valid empty result as insufficient data", async () => {
    await expect(
      providerWith(Response.json(empty)).fetchSeries(baseRequest, context),
    ).rejects.toBeInstanceOf(InsufficientDataError);
  });

  it("rejects malformed JSON and oversized streamed bodies", async () => {
    await expect(
      providerWith(new Response("not-json")).fetchSeries(baseRequest, context),
    ).rejects.toBeInstanceOf(ProviderSchemaError);
    await expect(
      readBoundedBody(new Response("12345"), 4),
    ).rejects.toBeInstanceOf(ProviderSchemaError);
  });

  it("retains upstream status and attempt metadata for diagnostics", async () => {
    const error = await providerWith(new Response(null, { status: 503 }))
      .fetchSeries(baseRequest, context)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ providerStatus: 503, attempt: 1 });
  });

  it("enforces the bounded total provider deadline", async () => {
    const provider = new LseProvider({
      apiKey: "fixture-key",
      timeoutMs: 5,
      maxAttempts: 1,
      fetch: (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => {
              reject(
                new DOMException("Provider request aborted", "AbortError"),
              );
            },
            { once: true },
          );
        }),
    });

    await expect(
      provider.fetchSeries(baseRequest, context),
    ).rejects.toMatchObject({
      name: ProviderTimeoutError.name,
      attempt: 1,
    });
  });
});

describe("parseLseUtcTimestamp", () => {
  it("parses provider timestamps explicitly as UTC", () => {
    expect(parseLseUtcTimestamp("2026-07-12 20:29:00.123456")).toBe(
      Date.UTC(2026, 6, 12, 20, 29, 0, 123),
    );
  });

  it.each([
    "2026-02-30 00:00:00",
    "2026-13-01 00:00:00",
    "not-a-date",
    "2026-01-01",
  ])("rejects invalid timestamp %s", (value) =>
    expect(parseLseUtcTimestamp(value)).toBeUndefined(),
  );
});
