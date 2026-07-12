import type { SourceInterval } from "./timeframe";

export type AssetType =
  "stock" | "crypto" | "etf" | "index" | "forex" | "unknown";

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
  points: readonly MarketPoint[];
}>;

export type MarketSeriesRequest = Readonly<{
  ticker: string;
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
  fetchSeries(
    request: MarketSeriesRequest,
    context: ProviderRequestContext,
  ): Promise<MarketSeries>;
}
