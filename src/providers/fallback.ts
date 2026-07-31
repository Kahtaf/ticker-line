import {
  InsufficientDataError,
  ProviderError,
  ProviderNotFoundError,
  ProviderRateLimitError,
} from "../domain/errors";
import type {
  MarketDataProvider,
  MarketSeries,
  MarketSeriesRequest,
  ProviderRequestContext,
} from "../domain/market-series";
import { errorLogFields, type Logger } from "../telemetry/logger";

export type FallbackProviderOptions = Readonly<{
  providers: readonly [MarketDataProvider, ...MarketDataProvider[]];
  logger: Logger;
}>;

function canFallback(error: unknown): boolean {
  return (
    error instanceof ProviderError ||
    error instanceof ProviderRateLimitError ||
    error instanceof ProviderNotFoundError ||
    error instanceof InsufficientDataError
  );
}

export class FallbackProvider implements MarketDataProvider {
  readonly id: string;
  readonly #providers: readonly [MarketDataProvider, ...MarketDataProvider[]];
  readonly #logger: Logger;

  constructor(options: FallbackProviderOptions) {
    this.#providers = options.providers;
    this.#logger = options.logger;
    this.id = options.providers.map(({ id }) => id).join("-");
  }

  async fetchSeries(
    request: MarketSeriesRequest,
    context: ProviderRequestContext,
  ): Promise<MarketSeries> {
    for (let index = 0; index < this.#providers.length; index += 1) {
      const provider = this.#providers[index];
      if (provider === undefined) break;
      try {
        return await provider.fetchSeries(request, context);
      } catch (error) {
        const fallback = this.#providers[index + 1];
        if (
          fallback === undefined ||
          context.signal.aborted ||
          !canFallback(error)
        ) {
          throw error;
        }
        this.#logger.warn("market_data_provider_fallback", {
          requestId: context.requestId,
          providerId: provider.id,
          fallbackProviderId: fallback.id,
          ticker: request.ticker,
          providerStatus:
            error instanceof ProviderError ? error.providerStatus : undefined,
          ...errorLogFields(error),
        });
      }
    }
    throw new ProviderError("No market data provider was available.");
  }
}
