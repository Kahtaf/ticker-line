import { z } from "zod";
import type { MarketSeries } from "../domain/market-series";
import type { SourceInterval } from "../domain/timeframe";
import {
  createDataCacheKey,
  createNegativeCacheKey,
  type DataCacheKeyParts,
} from "./keys";
import { NEGATIVE_CACHE_TTL_SECONDS } from "./policy";

const isoDate = z.iso.datetime({ offset: true });
const pointSchema = z
  .object({
    timestamp: z.number().int().finite(),
    close: z.number().finite(),
  })
  .readonly();
const seriesSchema = z
  .object({
    resolvedTicker: z.string().min(1),
    assetType: z.enum(["stock", "crypto", "etf", "index", "forex", "unknown"]),
    currency: z.string().optional(),
    exchange: z.string().optional(),
    timezone: z.string().optional(),
    dataAsOf: isoDate,
    referenceClose: z.number().finite(),
    points: z.array(pointSchema).min(1).max(5_000).readonly(),
  })
  .readonly();

export const cachedMarketSeriesSchema = z
  .object({
    schemaVersion: z.literal(2),
    fetchedAt: isoDate,
    freshUntil: isoDate,
    staleUntil: isoDate,
    retryAfter: isoDate.optional(),
    requestRange: z.object({
      start: isoDate,
      end: isoDate,
      interval: z.enum(["15m", "1h", "1d", "1w"]),
    }),
    series: seriesSchema,
  })
  .readonly();

export const negativeCacheRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.enum(["not_found", "insufficient_data"]),
    cachedAt: isoDate,
    expiresAt: isoDate,
  })
  .readonly();

export type CachedMarketSeries = Readonly<
  z.infer<typeof cachedMarketSeriesSchema>
>;
export type NegativeCacheRecord = Readonly<
  z.infer<typeof negativeCacheRecordSchema>
>;

export type DataCacheRead =
  | Readonly<{ state: "miss" }>
  | Readonly<{ state: "fresh"; record: CachedMarketSeries }>
  | Readonly<{
      state: "stale";
      record: CachedMarketSeries;
      refreshAllowed: boolean;
    }>
  | Readonly<{ state: "expired"; record: CachedMarketSeries }>;

export type NegativeCacheRead =
  | Readonly<{ state: "miss" }>
  | Readonly<{ state: "hit"; record: NegativeCacheRecord }>;

export type DataCacheLogger = Readonly<{
  warn?: (event: Readonly<Record<string, string>>) => void;
}>;

export interface MarketDataKvStore {
  get(key: string, type: "json"): Promise<unknown>;
  put(
    key: string,
    value: string,
    options: Readonly<{ expiration: number }>,
  ): Promise<void>;
}

const CLEANUP_MARGIN_SECONDS = 300;

export class MarketDataCache {
  readonly #kv: MarketDataKvStore;
  readonly #logger: DataCacheLogger;

  constructor(kv: MarketDataKvStore, logger: DataCacheLogger = {}) {
    this.#kv = kv;
    this.#logger = logger;
  }

  async read(
    parts: DataCacheKeyParts,
    now = new Date(),
  ): Promise<DataCacheRead> {
    const key = createDataCacheKey(parts);
    const raw: unknown = await this.#kv.get(key, "json");
    if (raw === null) return { state: "miss" };
    const parsed = cachedMarketSeriesSchema.safeParse(raw);
    if (!parsed.success) {
      this.#logger.warn?.({
        event: "invalid_data_cache_record",
        cacheKey: key,
      });
      return { state: "miss" };
    }
    const nowTime = now.getTime();
    const freshUntil = Date.parse(parsed.data.freshUntil);
    const staleUntil = Date.parse(parsed.data.staleUntil);
    if (nowTime < freshUntil) return { state: "fresh", record: parsed.data };
    if (nowTime < staleUntil) {
      const retryAfter = parsed.data.retryAfter;
      return {
        state: "stale",
        record: parsed.data,
        refreshAllowed:
          retryAfter === undefined || nowTime >= Date.parse(retryAfter),
      };
    }
    return { state: "expired", record: parsed.data };
  }

  async write(
    parts: DataCacheKeyParts,
    input: Readonly<{
      series: MarketSeries;
      requestRange: Readonly<{
        start: Date;
        end: Date;
        interval: SourceInterval;
      }>;
      freshForSeconds: number;
      staleForSeconds: number;
      retryAfter?: Date;
      now?: Date;
    }>,
  ): Promise<CachedMarketSeries> {
    const now = input.now ?? new Date();
    const freshUntil = new Date(now.getTime() + input.freshForSeconds * 1_000);
    const staleUntil = new Date(
      freshUntil.getTime() + input.staleForSeconds * 1_000,
    );
    const record: CachedMarketSeries = {
      schemaVersion: 2,
      fetchedAt: now.toISOString(),
      freshUntil: freshUntil.toISOString(),
      staleUntil: staleUntil.toISOString(),
      ...(input.retryAfter === undefined
        ? {}
        : { retryAfter: input.retryAfter.toISOString() }),
      requestRange: {
        start: input.requestRange.start.toISOString(),
        end: input.requestRange.end.toISOString(),
        interval: input.requestRange.interval,
      },
      series: input.series,
    };
    const validated = cachedMarketSeriesSchema.parse(record);
    await this.#kv.put(createDataCacheKey(parts), JSON.stringify(validated), {
      expiration:
        Math.floor(staleUntil.getTime() / 1_000) + CLEANUP_MARGIN_SECONDS,
    });
    return validated;
  }

  async markRetryBackoff(
    parts: DataCacheKeyParts,
    record: CachedMarketSeries,
    retryBackoffSeconds: number,
    now = new Date(),
  ): Promise<CachedMarketSeries> {
    const updated = cachedMarketSeriesSchema.parse({
      ...record,
      retryAfter: new Date(
        now.getTime() + retryBackoffSeconds * 1_000,
      ).toISOString(),
    });
    await this.#kv.put(createDataCacheKey(parts), JSON.stringify(updated), {
      expiration:
        Math.floor(Date.parse(updated.staleUntil) / 1_000) +
        CLEANUP_MARGIN_SECONDS,
    });
    return updated;
  }

  async readNegative(
    parts: DataCacheKeyParts,
    now = new Date(),
  ): Promise<NegativeCacheRead> {
    const key = createNegativeCacheKey(parts);
    const raw: unknown = await this.#kv.get(key, "json");
    if (raw === null) return { state: "miss" };
    const parsed = negativeCacheRecordSchema.safeParse(raw);
    if (!parsed.success) {
      this.#logger.warn?.({
        event: "invalid_negative_cache_record",
        cacheKey: key,
      });
      return { state: "miss" };
    }
    if (now.getTime() >= Date.parse(parsed.data.expiresAt))
      return { state: "miss" };
    return { state: "hit", record: parsed.data };
  }

  async writeNegative(
    parts: DataCacheKeyParts,
    kind: NegativeCacheRecord["kind"],
    now = new Date(),
  ): Promise<NegativeCacheRecord> {
    const ttl = NEGATIVE_CACHE_TTL_SECONDS[kind];
    const record: NegativeCacheRecord = {
      schemaVersion: 1,
      kind,
      cachedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttl * 1_000).toISOString(),
    };
    await this.#kv.put(createNegativeCacheKey(parts), JSON.stringify(record), {
      expiration:
        Math.floor(Date.parse(record.expiresAt) / 1_000) +
        CLEANUP_MARGIN_SECONDS,
    });
    return record;
  }
}
