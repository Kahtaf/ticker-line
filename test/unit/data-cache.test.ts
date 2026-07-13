import { describe, expect, it, vi } from "vitest";
import {
  MarketDataCache,
  type MarketDataKvStore,
} from "../../src/cache/data-cache";
import type { DataCacheKeyParts } from "../../src/cache/keys";

class MemoryKv implements MarketDataKvStore {
  readonly values = new Map<string, string>();
  readonly writes: Array<Readonly<{ key: string; expiration: number }>> = [];

  async get(key: string, _type: "json"): Promise<unknown> {
    const value = this.values.get(key);
    return value === undefined ? null : JSON.parse(value);
  }

  async put(
    key: string,
    value: string,
    options: Readonly<{ expiration: number }>,
  ): Promise<void> {
    this.values.set(key, value);
    this.writes.push({ key, expiration: options.expiration });
  }
}

const parts: DataCacheKeyParts = {
  cachePolicyVersion: "v1",
  providerId: "lse",
  providerVersion: "v1",
  normalizationVersion: "v1",
  ticker: "AAPL",
  timeframe: "1m",
  interval: "1d",
};

const now = new Date("2026-07-12T12:00:00.000Z");
const series = {
  resolvedTicker: "AAPL",
  assetType: "unknown" as const,
  dataAsOf: "2026-07-11T20:00:00.000Z",
  referenceClose: 213.5,
  points: [{ timestamp: Date.parse("2026-07-11T20:00:00.000Z"), close: 213.5 }],
};

describe("MarketDataCache", () => {
  it("transitions through fresh, stale, backoff, and expired logical states", async () => {
    const kv = new MemoryKv();
    const cache = new MarketDataCache(kv);
    const record = await cache.write(parts, {
      series,
      requestRange: {
        start: new Date("2026-06-12T12:00:00.000Z"),
        end: now,
        interval: "1d",
      },
      freshForSeconds: 60,
      staleForSeconds: 120,
      now,
    });

    expect(
      await cache.read(parts, new Date(now.getTime() + 59_000)),
    ).toMatchObject({
      state: "fresh",
    });
    expect(
      await cache.read(parts, new Date(now.getTime() + 60_000)),
    ).toMatchObject({
      state: "stale",
      refreshAllowed: true,
    });

    await cache.markRetryBackoff(
      parts,
      record,
      90,
      new Date(now.getTime() + 60_000),
    );
    expect(
      await cache.read(parts, new Date(now.getTime() + 61_000)),
    ).toMatchObject({
      state: "stale",
      refreshAllowed: false,
    });
    expect(
      await cache.read(parts, new Date(now.getTime() + 180_000)),
    ).toMatchObject({
      state: "expired",
    });
    expect(kv.writes[0]?.expiration).toBe(
      Math.floor((now.getTime() + 180_000) / 1_000) + 300,
    );
  });

  it("treats malformed and unknown-version values as sanitized misses", async () => {
    const kv = new MemoryKv();
    kv.values.set(
      "market-data:v1:lse:v1:v1:AAPL:1m:1d",
      JSON.stringify({ schemaVersion: 999, secret: "must-not-log" }),
    );
    const warn = vi.fn();
    const cache = new MarketDataCache(kv, { warn });
    expect(await cache.read(parts, now)).toEqual({ state: "miss" });
    expect(warn).toHaveBeenCalledWith({
      event: "invalid_data_cache_record",
      cacheKey: "market-data:v1:lse:v1:v1:AAPL:1m:1d",
    });
  });

  it.each([
    ["not_found", 300],
    ["insufficient_data", 600],
  ] as const)("stores and expires %s negative records", async (kind, ttl) => {
    const cache = new MarketDataCache(new MemoryKv());
    await cache.writeNegative(parts, kind, now);
    expect(
      await cache.readNegative(
        parts,
        new Date(now.getTime() + (ttl - 1) * 1_000),
      ),
    ).toMatchObject({
      state: "hit",
      record: { kind },
    });
    expect(
      await cache.readNegative(parts, new Date(now.getTime() + ttl * 1_000)),
    ).toEqual({
      state: "miss",
    });
  });
});
