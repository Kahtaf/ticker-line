import { describe, expect, it, vi } from "vitest";
import {
  MarketDataCache,
  type MarketDataKvStore,
} from "../../src/cache/data-cache";
import type { AppConfig } from "../../src/config";
import type {
  MarketSeries,
  MarketSeriesRequest,
  ProviderRequestContext,
} from "../../src/domain/market-series";
import type { CanonicalSparklineRequest } from "../../src/domain/request";
import { loadSeries, selectOneDaySeries } from "../../src/services/series";

const minute = 60_000;
const point = (timestamp: string, close: number) => ({
  timestamp: Date.parse(timestamp),
  close,
});

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

function series(
  assetType: MarketSeries["assetType"],
  points: MarketSeries["points"],
): MarketSeries {
  return {
    resolvedTicker: "TEST",
    assetType,
    dataAsOf: new Date(points.at(-1)?.timestamp ?? 0).toISOString(),
    referenceClose: points[0]?.close ?? 0,
    points,
  };
}

describe("one-day series selection", () => {
  it("uses the final provider candle before the latest exchange session", () => {
    const input = series("unknown", [
      point("2026-07-09T23:45:00Z", 98),
      point("2026-07-10T08:00:00Z", 100),
      point("2026-07-10T08:15:00Z", 101),
      point("2026-07-10T09:00:00Z", 103),
      point("2026-07-10T09:15:00Z", 104),
    ]);

    const selected = selectOneDaySeries(
      input,
      new Date("2026-07-10T12:00:00Z"),
    );

    expect(selected.referenceClose).toBe(98);
    expect(selected.points.map(({ close }) => close)).toEqual([
      100, 101, 103, 104,
    ]);
  });

  it("uses the trailing-window first close for continuously traded assets", () => {
    const start = Date.parse("2026-07-10T12:00:00Z");
    const input = series("crypto", [
      { timestamp: start - 15 * minute, close: 99 },
      { timestamp: start, close: 100 },
      { timestamp: start + 15 * minute, close: 101 },
    ]);

    const selected = selectOneDaySeries(input, new Date(start));

    expect(selected.referenceClose).toBe(100);
    expect(selected.points.map(({ close }) => close)).toEqual([100, 101]);
  });

  it("falls back to the trailing window if no exchange-session gap is present", () => {
    const start = Date.parse("2026-07-10T12:00:00Z");
    const input = series("index", [
      { timestamp: start - 15 * minute, close: 50 },
      { timestamp: start, close: 51 },
      { timestamp: start + 15 * minute, close: 52 },
    ]);

    const selected = selectOneDaySeries(input, new Date(start));

    expect(selected.referenceClose).toBe(51);
    expect(selected.points.map(({ close }) => close)).toEqual([51, 52]);
  });

  it("widens a one-day fetch and derives quote data with one provider call", async () => {
    const now = new Date("2026-07-13T12:00:00Z");
    const providerSeries = series("unknown", [
      point("2026-07-09T23:45:00Z", 98),
      point("2026-07-10T08:00:00Z", 100),
      point("2026-07-10T08:15:00Z", 101),
    ]);
    const fetchSeries = vi.fn(
      async (_request: MarketSeriesRequest, _context: ProviderRequestContext) =>
        providerSeries,
    );
    const request: CanonicalSparklineRequest = {
      ticker: "AAPL",
      timeframe: "1d",
      theme: "light",
      fill: false,
      format: "json",
    };
    const config: AppConfig = {
      environment: "staging",
      providerId: "lse",
      providerVersion: "v1",
      providerBaseUrl: "https://example.test",
      cachePolicyVersion: "v1",
      normalizationVersion: "v2",
      rendererVersion: "v4",
      providerApiKey: "test-only",
    };
    const recordMarketData = vi.fn(async () => {});
    const pending: Promise<unknown>[] = [];

    const result = await loadSeries({
      request,
      requestId: "request-1",
      config,
      cache: new MarketDataCache(new MemoryKv()),
      provider: { id: "lse", fetchSeries },
      now,
      signal: new AbortController().signal,
      logger: { info() {}, warn() {}, error() {} },
      waitUntil(promise) {
        pending.push(promise);
      },
      statusReporter: { recordMarketData },
    });
    await Promise.all(pending);

    expect(fetchSeries).toHaveBeenCalledOnce();
    expect(recordMarketData).toHaveBeenCalledWith("operational", now);
    expect(fetchSeries.mock.calls[0]?.[0]).toMatchObject({
      ticker: "AAPL",
      interval: "15m",
      start: new Date("2026-07-05T12:00:00Z"),
      end: now,
    });
    expect(result.series.referenceClose).toBe(98);
    expect(result.series.points.map(({ close }) => close)).toEqual([100, 101]);
  });
});
