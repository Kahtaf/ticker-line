import type { CachedMarketSeries, MarketDataCache } from "../cache/data-cache";
import type { DataCacheKeyParts } from "../cache/keys";
import {
  defaultFreshnessPolicy,
  type FreshnessDecision,
} from "../cache/policy";
import {
  InsufficientDataError,
  ProviderNotFoundError,
  TickerNotFoundError,
} from "../domain/errors";
import type {
  MarketDataProvider,
  MarketSeries,
  MarketSeriesRequest,
} from "../domain/market-series";
import type { CanonicalSparklineRequest } from "../domain/request";
import { getTimeframePolicy, getTimeframeRange } from "../domain/timeframe";
import type { AppConfig } from "../config";
import type { Logger } from "../telemetry/logger";

export type SeriesResult = Readonly<{
  series: MarketSeries;
  freshUntil: Date;
  staleUntil: Date;
  freshness: FreshnessDecision;
  cacheState: "MISS" | "STALE";
}>;

export type SeriesServiceOptions = Readonly<{
  request: CanonicalSparklineRequest;
  requestId: string;
  config: AppConfig;
  cache: MarketDataCache;
  provider: MarketDataProvider;
  now: Date;
  signal: AbortSignal;
  logger: Logger;
  waitUntil(promise: Promise<unknown>): void;
}>;

function keyParts(
  request: CanonicalSparklineRequest,
  config: AppConfig,
): DataCacheKeyParts {
  return {
    cachePolicyVersion: config.cachePolicyVersion,
    providerId: config.providerId,
    providerVersion: config.providerVersion,
    normalizationVersion: config.normalizationVersion,
    ticker: request.ticker,
    timeframe: request.timeframe,
    interval: getTimeframePolicy(request.timeframe).interval,
  };
}

function mostRecentSession(series: MarketSeries): MarketSeries {
  const latest = series.points.at(-1);
  if (latest === undefined) throw new InsufficientDataError();
  const session = new Date(latest.timestamp).toISOString().slice(0, 10);
  const points = series.points.filter(
    (point) => new Date(point.timestamp).toISOString().slice(0, 10) === session,
  );
  if (points.length === 0) throw new InsufficientDataError();
  return { ...series, points };
}

async function fetchWithLastSessionFallback(
  provider: MarketDataProvider,
  request: CanonicalSparklineRequest,
  now: Date,
  requestId: string,
  signal: AbortSignal,
): Promise<Readonly<{ series: MarketSeries; range: MarketSeriesRequest }>> {
  const interval = getTimeframePolicy(request.timeframe).interval;
  const requestedRange = getTimeframeRange(request.timeframe, now);
  const range: MarketSeriesRequest = {
    ticker: request.ticker,
    interval,
    ...requestedRange,
  };
  try {
    const series = await provider.fetchSeries(range, { requestId, signal });
    return { series, range };
  } catch (error) {
    if (
      !(error instanceof InsufficientDataError) ||
      request.timeframe !== "1d"
    ) {
      throw error;
    }
  }

  const extendedRange: MarketSeriesRequest = {
    ...range,
    start: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1_000),
  };
  const extended = await provider.fetchSeries(extendedRange, {
    requestId,
    signal,
  });
  return { series: mostRecentSession(extended), range: extendedRange };
}

async function refresh(
  options: SeriesServiceOptions,
  parts: DataCacheKeyParts,
): Promise<CachedMarketSeries> {
  const fetched = await fetchWithLastSessionFallback(
    options.provider,
    options.request,
    options.now,
    options.requestId,
    options.signal,
  );
  const freshness = defaultFreshnessPolicy.evaluate({
    timeframe: options.request.timeframe,
    assetType: fetched.series.assetType,
    now: options.now,
  });
  return options.cache.write(parts, {
    series: fetched.series,
    requestRange: fetched.range,
    freshForSeconds: freshness.freshForSeconds,
    staleForSeconds: freshness.staleForSeconds,
    now: options.now,
  });
}

function fromRecord(
  record: CachedMarketSeries,
  request: CanonicalSparklineRequest,
  cacheState: "MISS" | "STALE",
  now: Date,
): SeriesResult {
  const cachedSeries = record.series;
  const series: MarketSeries = {
    resolvedTicker: cachedSeries.resolvedTicker,
    assetType: cachedSeries.assetType,
    dataAsOf: cachedSeries.dataAsOf,
    points: cachedSeries.points,
    ...(cachedSeries.currency === undefined
      ? {}
      : { currency: cachedSeries.currency }),
    ...(cachedSeries.exchange === undefined
      ? {}
      : { exchange: cachedSeries.exchange }),
    ...(cachedSeries.timezone === undefined
      ? {}
      : { timezone: cachedSeries.timezone }),
  };
  return {
    series,
    freshUntil: new Date(record.freshUntil),
    staleUntil: new Date(record.staleUntil),
    freshness: defaultFreshnessPolicy.evaluate({
      timeframe: request.timeframe,
      assetType: record.series.assetType,
      now,
    }),
    cacheState,
  };
}

export async function loadSeries(
  options: SeriesServiceOptions,
): Promise<SeriesResult> {
  const parts = keyParts(options.request, options.config);
  const cached = await options.cache.read(parts, options.now);
  if (cached.state === "fresh") {
    return fromRecord(cached.record, options.request, "MISS", options.now);
  }

  if (cached.state === "stale") {
    if (cached.refreshAllowed) {
      const backgroundRefresh = refresh(options, parts).catch(
        async (error: unknown) => {
          await options.cache.markRetryBackoff(
            parts,
            cached.record,
            defaultFreshnessPolicy.evaluate({
              timeframe: options.request.timeframe,
              assetType: cached.record.series.assetType,
              now: options.now,
            }).retryBackoffSeconds,
            options.now,
          );
          options.logger.warn("market_data_background_refresh_failed", {
            requestId: options.requestId,
            ticker: options.request.ticker,
            timeframe: options.request.timeframe,
            errorType: error instanceof Error ? error.name : "UnknownError",
          });
        },
      );
      options.waitUntil(backgroundRefresh);
    }
    return fromRecord(cached.record, options.request, "STALE", options.now);
  }

  const negative = await options.cache.readNegative(parts, options.now);
  if (negative.state === "hit") {
    if (negative.record.kind === "not_found") throw new TickerNotFoundError();
    throw new InsufficientDataError();
  }

  try {
    const record = await refresh(options, parts);
    return fromRecord(record, options.request, "MISS", options.now);
  } catch (error) {
    if (error instanceof ProviderNotFoundError) {
      await options.cache.writeNegative(parts, "not_found", options.now);
    } else if (error instanceof InsufficientDataError) {
      await options.cache.writeNegative(
        parts,
        "insufficient_data",
        options.now,
      );
    }
    throw error;
  }
}
