import {
  InsufficientDataError,
  ProviderAuthenticationError,
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
    const candidates = this.#providers.filter(
      (provider) => provider.supports?.(request.market) ?? true,
    );
    if (candidates.length === 0) throw new ProviderNotFoundError();

    let authFailure: ProviderAuthenticationError | undefined;
    for (let index = 0; index < candidates.length; index += 1) {
      const provider = candidates[index];
      if (provider === undefined) break;
      try {
        return await provider.fetchSeries(request, context);
      } catch (error) {
        if (error instanceof ProviderAuthenticationError) {
          authFailure ??= error;
          this.#logger.error("market_data_provider_auth_failed", {
            requestId: context.requestId,
            providerId: provider.id,
            providerStatus: error.providerStatus,
            ticker: request.ticker,
            market: request.market,
          });
        }
        const fallback = candidates[index + 1];
        if (fallback === undefined && authFailure !== undefined) {
          // A not-found or empty answer from a later provider does not prove
          // the symbol is missing when an earlier one rejected its credential.
          if (
            error instanceof ProviderNotFoundError ||
            error instanceof InsufficientDataError
          ) {
            throw authFailure;
          }
        }
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
          market: request.market,
          providerStatus:
            error instanceof ProviderError ? error.providerStatus : undefined,
          ...errorLogFields(error),
        });
      }
    }
    throw new ProviderError("No market data provider was available.");
  }
}
