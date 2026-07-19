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
  AssetType,
  MarketDataProvider,
  MarketPoint,
  MarketSeries,
  MarketSeriesRequest,
} from "../domain/market-series";
import type { CanonicalSparklineRequest } from "../domain/request";
import { getTimeframePolicy, getTimeframeRange } from "../domain/timeframe";
import type { AppConfig } from "../config";
import {
  marketDataStatusForError,
  type ServiceStatusRepository,
  type StoredMarketDataStatus,
} from "../status/service-status";
import { errorLogFields, type Logger } from "../telemetry/logger";

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
  statusReporter?: Pick<ServiceStatusRepository, "recordMarketData">;
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

const ONE_DAY_MS = 24 * 60 * 60 * 1_000;
const ONE_DAY_PROVIDER_LOOKBACK_MS = 8 * ONE_DAY_MS;
const ONE_DAY_INTERVAL_MS = 15 * 60 * 1_000;
const ONE_DAY_LATEST_CANDLE_GRACE_MS = 2 * ONE_DAY_INTERVAL_MS;
const SESSION_GAP_MS = 2 * 60 * 60 * 1_000;

function isSessionBased(assetType: AssetType): boolean {
  return assetType !== "crypto" && assetType !== "forex";
}

function trailingPoints(
  points: readonly MarketPoint[],
  visibleStart: Date,
): readonly MarketPoint[] {
  const latest = points.at(-1);
  if (latest === undefined) return [];
  const requestedEnd = visibleStart.getTime() + ONE_DAY_MS;
  const latestDelay = requestedEnd - latest.timestamp;
  const effectiveStart =
    latestDelay > ONE_DAY_LATEST_CANDLE_GRACE_MS
      ? latest.timestamp - ONE_DAY_MS
      : visibleStart.getTime();
  const visible = points.filter((point) => point.timestamp >= effectiveStart);
  return visible.length > 0 ? visible : [latest];
}

/**
 * Select the visible one-day series and its comparison candle from one widened
 * provider response. Exchange-traded series use the final candle before the
 * latest overnight/session gap; continuously traded series use the first close
 * in the trailing 24-hour window.
 */
export function selectOneDaySeries(
  series: MarketSeries,
  visibleStart: Date,
): MarketSeries {
  if (!isSessionBased(series.assetType)) {
    const points = trailingPoints(series.points, visibleStart);
    const referenceClose = points[0]?.close;
    if (referenceClose === undefined) throw new InsufficientDataError();
    return { ...series, referenceClose, points };
  }

  let sessionStart = 0;
  for (let index = 1; index < series.points.length; index += 1) {
    const previous = series.points[index - 1];
    const current = series.points[index];
    if (
      previous !== undefined &&
      current !== undefined &&
      current.timestamp - previous.timestamp > SESSION_GAP_MS
    ) {
      sessionStart = index;
    }
  }
  const reference = series.points[sessionStart - 1];
  if (reference !== undefined) {
    return {
      ...series,
      referenceClose: reference.close,
      points: series.points.slice(sessionStart),
    };
  }

  const points = trailingPoints(series.points, visibleStart);
  const referenceClose = points[0]?.close;
  if (referenceClose === undefined) throw new InsufficientDataError();
  return { ...series, referenceClose, points };
}

async function fetchSelectedSeries(
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
    start:
      request.timeframe === "1d"
        ? new Date(requestedRange.end.getTime() - ONE_DAY_PROVIDER_LOOKBACK_MS)
        : requestedRange.start,
    end: requestedRange.end,
  };
  const fetched = await provider.fetchSeries(range, { requestId, signal });
  const series =
    request.timeframe === "1d"
      ? selectOneDaySeries(fetched, requestedRange.start)
      : {
          ...fetched,
          referenceClose: fetched.points[0]?.close ?? fetched.referenceClose,
        };
  return { series, range };
}

async function refresh(
  options: SeriesServiceOptions,
  parts: DataCacheKeyParts,
): Promise<CachedMarketSeries> {
  let fetched: Awaited<ReturnType<typeof fetchSelectedSeries>>;
  try {
    fetched = await fetchSelectedSeries(
      options.provider,
      options.request,
      options.now,
      options.requestId,
      options.signal,
    );
    reportMarketDataStatus(options, "operational");
  } catch (error) {
    const status = marketDataStatusForError(error);
    if (status !== undefined) reportMarketDataStatus(options, status);
    throw error;
  }
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

function reportMarketDataStatus(
  options: SeriesServiceOptions,
  status: StoredMarketDataStatus,
): void {
  if (options.statusReporter === undefined) return;
  options.waitUntil(
    options.statusReporter
      .recordMarketData(status, options.now)
      .catch((error: unknown) => {
        options.logger.warn("service_status_write_failed", {
          requestId: options.requestId,
          status,
          ...errorLogFields(error),
        });
      }),
  );
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
    referenceClose: cachedSeries.referenceClose,
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
      const refreshStartedAt = Date.now();
      const backgroundRefresh = refresh(
        { ...options, signal: new AbortController().signal },
        parts,
      ).catch(async (error: unknown) => {
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
          providerId: options.config.providerId,
          ticker: options.request.ticker,
          timeframe: options.request.timeframe,
          durationMs: Date.now() - refreshStartedAt,
          ...errorLogFields(error),
        });
      });
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
