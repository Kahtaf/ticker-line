import type { AppConfig } from "../config";
import type { MarketDataProvider } from "../domain/market-series";
import type { Logger } from "../telemetry/logger";
import { FallbackProvider } from "./fallback";
import { LseProvider } from "./lse/adapter";
import { SiftingProvider } from "./sifting/adapter";

export const PROVIDER_NAMES = ["lse", "sifting"] as const;
export type ProviderName = (typeof PROVIDER_NAMES)[number];
export type ProviderOrder = readonly [ProviderName, ...ProviderName[]];

/**
 * Sifting leads and LSE is the fallback. Sifting cannot serve `index`, so
 * indices go straight to LSE. Swap with `PROVIDER_ORDER=lse,sifting`.
 */
export const DEFAULT_PROVIDER_ORDER: ProviderOrder = ["sifting", "lse"];

/** Secret binding that holds each provider's API key. */
export const PROVIDER_API_KEY_BINDINGS: Readonly<Record<ProviderName, string>> =
  {
    lse: "LSE_API_KEY",
    sifting: "SIFTING_API_KEY",
  };

export class ProviderConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderConfigurationError";
  }
}

function isProviderName(value: string): value is ProviderName {
  return (PROVIDER_NAMES as readonly string[]).includes(value);
}

/**
 * Parse a comma-separated provider order such as `sifting,lse`.
 * An unset or empty value selects the default order.
 */
export function parseProviderOrder(value: string | undefined): ProviderOrder {
  const names = (value ?? "")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter((name) => name.length > 0);
  const order: ProviderName[] = [];
  for (const name of names) {
    if (!isProviderName(name)) {
      throw new ProviderConfigurationError(
        `Unknown provider "${name}" in PROVIDER_ORDER. Expected a comma-separated list of: ${PROVIDER_NAMES.join(", ")}.`,
      );
    }
    if (order.includes(name)) {
      throw new ProviderConfigurationError(
        `Duplicate provider "${name}" in PROVIDER_ORDER.`,
      );
    }
    order.push(name);
  }
  const [first, ...rest] = order;
  return first === undefined ? DEFAULT_PROVIDER_ORDER : [first, ...rest];
}

export type ProviderChainOptions = Readonly<{
  logger: Logger;
  fetch?: typeof fetch;
}>;

function createProvider(
  name: ProviderName,
  config: AppConfig,
  providerFetch: typeof fetch | undefined,
): MarketDataProvider {
  const fetchOption =
    providerFetch === undefined ? {} : { fetch: providerFetch };
  switch (name) {
    case "lse":
      return new LseProvider({
        apiKey: config.lseApiKey ?? "",
        baseUrl: config.lseBaseUrl,
        ...fetchOption,
      });
    case "sifting":
      return new SiftingProvider({
        apiKey: config.siftingApiKey ?? "",
        baseUrl: config.siftingBaseUrl,
        ...fetchOption,
      });
  }
}

/** Build the ordered fallback chain described by `config.providerOrder`. */
export function createProviderChain(
  config: AppConfig,
  options: ProviderChainOptions,
): FallbackProvider {
  const [first, ...rest] = config.providerOrder;
  return new FallbackProvider({
    providers: [
      createProvider(first, config, options.fetch),
      ...rest.map((name) => createProvider(name, config, options.fetch)),
    ],
    logger: options.logger,
  });
}
