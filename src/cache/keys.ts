import type { CanonicalSparklineRequest } from "../domain/request";
import type { SourceInterval, Timeframe } from "../domain/timeframe";

export type DataCacheKeyParts = Readonly<{
  cachePolicyVersion: string;
  providerId: string;
  providerVersion: string;
  normalizationVersion: string;
  ticker: string;
  timeframe: Timeframe;
  interval: SourceInterval;
}>;

function segment(value: string): string {
  return encodeURIComponent(value);
}

export function createDataCacheKey(parts: DataCacheKeyParts): string {
  return [
    "market-data",
    parts.cachePolicyVersion,
    parts.providerId,
    parts.providerVersion,
    parts.normalizationVersion,
    parts.ticker,
    parts.timeframe,
    parts.interval,
  ]
    .map(segment)
    .join(":");
}

export function createNegativeCacheKey(parts: DataCacheKeyParts): string {
  return createDataCacheKey(parts).replace(
    /^market-data:/,
    "market-data-negative:",
  );
}

export function createResponseCacheKey(
  request: CanonicalSparklineRequest,
  versions: Readonly<{ rendererVersion: string; normalizationVersion: string }>,
): Request {
  const url = new URL(
    `https://cache.internal/render/${segment(versions.rendererVersion)}/${segment(versions.normalizationVersion)}`,
  );
  url.searchParams.set("ticker", request.ticker);
  url.searchParams.set("timeframe", request.timeframe);
  url.searchParams.set("theme", request.theme);
  url.searchParams.set("color", request.color);
  url.searchParams.set("format", request.format);
  return new Request(url, { method: "GET" });
}

export function createFallbackCacheKey(
  errorCode: string,
  fallbackRendererVersion: string,
): Request {
  const url = new URL(
    `https://cache.internal/fallback/${segment(fallbackRendererVersion)}/${segment(errorCode)}`,
  );
  return new Request(url, { method: "GET" });
}
