import { z } from "zod";

const environmentSchema = z.object({
  APP_ENV: z.enum(["staging", "production"]),
  PROVIDER_ID: z.literal("sifting-lse"),
  PROVIDER_VERSION: z.string().min(1),
  SIFTING_BASE_URL: z.url().startsWith("https://"),
  LSE_BASE_URL: z.url().startsWith("https://"),
  CACHE_POLICY_VERSION: z.string().min(1),
  NORMALIZATION_VERSION: z.string().min(1),
  RENDERER_VERSION: z.string().min(1),
  SIFTING_API_KEY: z.string().min(1),
  LSE_API_KEY: z.string().min(1),
});

export type AppConfig = Readonly<{
  environment: "staging" | "production";
  providerId: "sifting-lse";
  providerVersion: string;
  siftingBaseUrl: string;
  lseBaseUrl: string;
  cachePolicyVersion: string;
  normalizationVersion: string;
  rendererVersion: string;
  siftingApiKey: string;
  lseApiKey: string;
}>;

export function readConfig(env: Env): AppConfig {
  const parsed = environmentSchema.parse(env);

  return {
    environment: parsed.APP_ENV,
    providerId: parsed.PROVIDER_ID,
    providerVersion: parsed.PROVIDER_VERSION,
    siftingBaseUrl: parsed.SIFTING_BASE_URL,
    lseBaseUrl: parsed.LSE_BASE_URL,
    cachePolicyVersion: parsed.CACHE_POLICY_VERSION,
    normalizationVersion: parsed.NORMALIZATION_VERSION,
    rendererVersion: parsed.RENDERER_VERSION,
    siftingApiKey: parsed.SIFTING_API_KEY,
    lseApiKey: parsed.LSE_API_KEY,
  };
}
