export type {
  MarketDataProvider,
  ProviderRequestContext,
} from "../domain/market-series";

export const PROVIDER_REQUEST_TIMEOUT_MS = 10_000;
export const PROVIDER_RESPONSE_MAX_BYTES = 2 * 1024 * 1024;
export const PROVIDER_MAX_RAW_POINTS = 5_000;
