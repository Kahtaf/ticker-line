import { z } from "zod";
import {
  PROVIDER_API_KEY_BINDINGS,
  ProviderConfigurationError,
  parseProviderOrder,
  type ProviderOrder,
} from "./providers/registry";

const optionalSecret = z.string().optional();

const environmentSchema = z.object({
  APP_ENV: z.enum(["staging", "production"]),
  PROVIDER_ORDER: z.string().optional(),
  PROVIDER_VERSION: z.string().min(1),
  SIFTING_BASE_URL: z.url().startsWith("https://"),
  LSE_BASE_URL: z.url().startsWith("https://"),
  CACHE_POLICY_VERSION: z.string().min(1),
  NORMALIZATION_VERSION: z.string().min(1),
  RENDERER_VERSION: z.string().min(1),
  SIFTING_API_KEY: optionalSecret,
  LSE_API_KEY: optionalSecret,
});

export type AppConfig = Readonly<{
  environment: "staging" | "production";
  /** Providers in the order they are tried. */
  providerOrder: ProviderOrder;
  /** Cache-key identity derived from the provider order, e.g. `sifting-lse`. */
  providerId: string;
  providerVersion: string;
  siftingBaseUrl: string;
  lseBaseUrl: string;
  cachePolicyVersion: string;
  normalizationVersion: string;
  rendererVersion: string;
  siftingApiKey?: string;
  lseApiKey?: string;
}>;

export function readConfig(env: Env): AppConfig {
  const parsed = environmentSchema.parse(env);
  const providerOrder = parseProviderOrder(parsed.PROVIDER_ORDER);
  const apiKeys = {
    lse: parsed.LSE_API_KEY,
    sifting: parsed.SIFTING_API_KEY,
  } as const;
  for (const name of providerOrder) {
    const key = apiKeys[name];
    if (key === undefined || key.length === 0) {
      throw new ProviderConfigurationError(
        `${PROVIDER_API_KEY_BINDINGS[name]} is required because PROVIDER_ORDER includes "${name}".`,
      );
    }
  }

  const config: AppConfig = {
    environment: parsed.APP_ENV,
    providerOrder,
    providerId: providerOrder.join("-"),
    providerVersion: parsed.PROVIDER_VERSION,
    siftingBaseUrl: parsed.SIFTING_BASE_URL,
    lseBaseUrl: parsed.LSE_BASE_URL,
    cachePolicyVersion: parsed.CACHE_POLICY_VERSION,
    normalizationVersion: parsed.NORMALIZATION_VERSION,
    rendererVersion: parsed.RENDERER_VERSION,
  };
  return {
    ...config,
    ...(apiKeys.sifting === undefined
      ? {}
      : { siftingApiKey: apiKeys.sifting }),
    ...(apiKeys.lse === undefined ? {} : { lseApiKey: apiKeys.lse }),
  };
}
