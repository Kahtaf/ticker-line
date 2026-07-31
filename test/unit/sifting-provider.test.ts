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
import { SiftingProvider } from "../../src/providers/sifting/adapter";
import { toSiftingSymbol } from "../../src/providers/sifting/symbols";
import aapl from "../fixtures/provider/sifting-aapl.json";
import btc from "../fixtures/provider/sifting-btc.json";

const baseRequest: MarketSeriesRequest = {
  ticker: "AAPL",
  start: new Date("2026-07-01T12:00:00.000Z"),
  end: new Date("2026-07-31T12:00:00.000Z"),
  interval: "1d",
};

const context = {
  requestId: "request-1",
  signal: new AbortController().signal,
};

function providerWith(
  response: Response,
  inspect?: (request: Request) => void,
): SiftingProvider {
  const providerFetch: typeof fetch = (input, init) => {
    inspect?.(new Request(input, init));
    return Promise.resolve(response);
  };
  return new SiftingProvider({
    apiKey: "fixture-key",
    maxAttempts: 1,
    fetch: vi.fn(providerFetch),
  });
}

describe("Sifting symbols", () => {
  it.each([
    ["AAPL", "stocks", "AAPL", "stock", "USD"],
    ["SPY", "stocks", "SPY", "etf", "USD"],
    ["BTC/USD", "crypto", "BTCUSD", "crypto", "USD"],
    ["BTC-USD", "crypto", "BTCUSD", "crypto", "USD"],
    ["XAU/USD", "commodities", "XAUUSD", "unknown", "USD"],
    ["USD/CAD", "forex", "USDCAD", "forex", "CAD"],
    ["EURUSD=X", "forex", "EURUSD", "forex", "USD"],
  ] as const)(
    "maps %s to the documented %s symbol format",
    (ticker, market, symbol, assetType, currency) => {
      expect(toSiftingSymbol(ticker)).toEqual({
        market,
        symbol,
        assetType,
        currency,
      });
    },
  );

  it.each(["NAS100/USD", "^GSPC", "VOD.L=X"])(
    "leaves unsupported symbol %s for the next provider",
    (ticker) => expect(toSiftingSymbol(ticker)).toBeUndefined(),
  );
});

describe("SiftingProvider", () => {
  it("uses the stocks endpoint and normalizes epoch-millisecond bars", async () => {
    let requested: Request | undefined;
    const series = await providerWith(Response.json(aapl), (request) => {
      requested = request;
    }).fetchSeries(baseRequest, context);

    const url = new URL(requested?.url ?? "https://invalid.test");
    expect(url.pathname).toBe("/v1/hist/stocks/AAPL/bars");
    expect(url.searchParams.get("start")).toBe("2026-07-01T12:00:00.000Z");
    expect(url.searchParams.get("end")).toBe("2026-07-31T12:00:00.000Z");
    expect(url.searchParams.get("interval")).toBe("1d");
    expect(url.searchParams.get("limit")).toBe("2000");
    expect(requested?.headers.get("x-api-key")).toBe("fixture-key");
    expect(requested?.headers.get("accept-encoding")).toContain("gzip");
    expect(series).toEqual({
      resolvedTicker: "AAPL",
      assetType: "stock",
      currency: "USD",
      timezone: "America/New_York",
      dataAsOf: "2026-07-29T17:30:00.000Z",
      referenceClose: 212.75,
      points: [
        { timestamp: 1785259800000, close: 212.75 },
        { timestamp: 1785346200000, close: 214.5 },
      ],
    });
  });

  it("maps slash crypto symbols and replaces unsupported weekly bars with daily bars", async () => {
    let requestedUrl: URL | undefined;
    const series = await providerWith(Response.json(btc), (request) => {
      requestedUrl = new URL(request.url);
    }).fetchSeries(
      { ...baseRequest, ticker: "BTC/USD", interval: "1w" },
      context,
    );

    expect(requestedUrl?.pathname).toBe("/v1/hist/crypto/BTCUSD/bars");
    expect(requestedUrl?.searchParams.get("interval")).toBe("1d");
    expect(requestedUrl?.searchParams.get("limit")).toBe("5000");
    expect(series.resolvedTicker).toBe("BTC/USD");
    expect(series.assetType).toBe("crypto");
    expect(series.currency).toBe("USD");
    expect(series.timezone).toBe("UTC");
  });

  it("preserves weekly bars for the stocks endpoint", async () => {
    let requestedUrl: URL | undefined;
    await providerWith(Response.json(aapl), (request) => {
      requestedUrl = new URL(request.url);
    }).fetchSeries({ ...baseRequest, interval: "1w" }, context);
    expect(requestedUrl?.searchParams.get("interval")).toBe("1w");
  });

  it("deduplicates, sorts, and keeps the final close at a timestamp", async () => {
    const payload = {
      ...aapl,
      data: [aapl.data[1], aapl.data[0], { ...aapl.data[0], c: 999 }],
    };
    const series = await providerWith(Response.json(payload)).fetchSeries(
      baseRequest,
      context,
    );
    expect(series.points.map(({ close }) => close)).toEqual([999, 214.5]);
  });

  it.each([
    [401, ProviderAuthenticationError],
    [403, ProviderAuthenticationError],
    [404, ProviderNotFoundError],
    [422, InsufficientDataError],
  ] as const)("maps provider status %s", async (status, ErrorClass) => {
    await expect(
      providerWith(new Response(null, { status })).fetchSeries(
        baseRequest,
        context,
      ),
    ).rejects.toBeInstanceOf(ErrorClass);
  });

  it("maps 429 and preserves Retry-After", async () => {
    const error = await providerWith(
      new Response(null, { status: 429, headers: { "Retry-After": "17" } }),
    )
      .fetchSeries(baseRequest, context)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProviderRateLimitError);
    expect((error as ProviderRateLimitError).retryAfterSeconds).toBe(17);
  });

  it("follows bounded pagination while preserving interval and end", async () => {
    const firstPage = {
      ...btc,
      meta: { ...btc.meta, next_cursor: "another-page" },
    };
    const secondPage = {
      ...btc,
      data: [
        {
          t: 1785542400000,
          o: 64825.995,
          h: 65000,
          l: 64700,
          c: 64950,
          v: 3,
        },
      ],
    };
    const requestedUrls: URL[] = [];
    const responses = [Response.json(firstPage), Response.json(secondPage)];
    const provider = new SiftingProvider({
      apiKey: "fixture-key",
      maxAttempts: 1,
      fetch: (input) => {
        requestedUrls.push(new URL(new Request(input).url));
        const response = responses.shift();
        if (response === undefined) throw new Error("Unexpected request");
        return Promise.resolve(response);
      },
    });

    const series = await provider.fetchSeries(
      { ...baseRequest, ticker: "BTC/USD", interval: "1w" },
      context,
    );
    expect(requestedUrls).toHaveLength(2);
    expect(requestedUrls[1]?.searchParams.get("cursor")).toBe("another-page");
    expect(requestedUrls[1]?.searchParams.has("start")).toBe(false);
    expect(requestedUrls[1]?.searchParams.get("end")).toBe(
      "2026-07-31T12:00:00.000Z",
    );
    expect(requestedUrls[1]?.searchParams.get("interval")).toBe("1d");
    expect(series.points).toHaveLength(3);
    expect(series.points.at(-1)?.close).toBe(64950);
  });

  it("rejects empty, malformed, over-paginated, and oversized responses", async () => {
    await expect(
      providerWith(Response.json({ data: [], meta: aapl.meta })).fetchSeries(
        baseRequest,
        context,
      ),
    ).rejects.toBeInstanceOf(InsufficientDataError);
    await expect(
      providerWith(new Response("not-json")).fetchSeries(baseRequest, context),
    ).rejects.toBeInstanceOf(ProviderSchemaError);
    const paginated = Response.json({
      ...aapl,
      meta: { ...aapl.meta, next_cursor: "another-page" },
    });
    await expect(
      new SiftingProvider({
        apiKey: "fixture-key",
        maxAttempts: 1,
        fetch: () => Promise.resolve(paginated.clone()),
      }).fetchSeries(baseRequest, context),
    ).rejects.toBeInstanceOf(ProviderSchemaError);
    await expect(
      new SiftingProvider({
        apiKey: "fixture-key",
        maxAttempts: 1,
        maxResponseBytes: 4,
        fetch: () => Promise.resolve(new Response("12345")),
      }).fetchSeries(baseRequest, context),
    ).rejects.toBeInstanceOf(ProviderSchemaError);
  });

  it("retains upstream status and attempt metadata", async () => {
    const error = await providerWith(new Response(null, { status: 503 }))
      .fetchSeries(baseRequest, context)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ providerStatus: 503, attempt: 1 });
  });

  it("enforces the bounded provider deadline", async () => {
    const provider = new SiftingProvider({
      apiKey: "fixture-key",
      timeoutMs: 5,
      maxAttempts: 1,
      fetch: (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        }),
    });
    await expect(
      provider.fetchSeries(baseRequest, context),
    ).rejects.toBeInstanceOf(ProviderTimeoutError);
  });
});
