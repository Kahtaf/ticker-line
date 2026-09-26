import type { SourceInterval } from "./timeframe";

export const MARKETS = [
  "stock",
  "crypto",
  "forex",
  "commodity",
  "index",
] as const;
export type Market = (typeof MARKETS)[number];

export type AssetType = Market | "etf" | "unknown";

export type MarketPoint = Readonly<{
  timestamp: number;
  close: number;
}>;

export type MarketSeries = Readonly<{
  resolvedTicker: string;
  assetType: AssetType;
  currency?: string;
  exchange?: string;
  timezone?: string;
  dataAsOf: string;
  referenceClose: number;
  points: readonly MarketPoint[];
}>;

export type MarketSeriesRequest = Readonly<{
  ticker: string;
  market: Market;
  start: Date;
  end: Date;
  interval: SourceInterval;
}>;

export type ProviderRequestContext = Readonly<{
  requestId: string;
  signal: AbortSignal;
}>;

export interface MarketDataProvider {
  readonly id: string;
  /**
   * Whether this provider can serve the market at all. Omitted means every
   * market. Unsupported providers are skipped rather than counted as failures.
   */
  supports?(market: Market): boolean;
  fetchSeries(
    request: MarketSeriesRequest,
    context: ProviderRequestContext,
  ): Promise<MarketSeries>;
}
