import { z } from "zod";
import {
  ProviderAuthenticationError,
  ProviderError,
  ProviderRateLimitError,
} from "../domain/errors";
import type { Logger } from "../telemetry/logger";

export const SERVICE_STATUS_KEY = "service-status:v1";
export const STATUS_OBSERVATION_MAX_AGE_MS = 60 * 60 * 1_000;

const storedMarketDataStatusSchema = z.enum([
  "operational",
  "degraded",
  "unavailable",
]);

export type StoredMarketDataStatus = z.infer<
  typeof storedMarketDataStatusSchema
>;
export type PublicServiceState = StoredMarketDataStatus | "unknown";

export const serviceStatusRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    marketData: storedMarketDataStatusSchema,
    checkedAt: z.iso.datetime({ offset: true }),
  })
  .readonly();

export type ServiceStatusRecord = Readonly<
  z.infer<typeof serviceStatusRecordSchema>
>;

export type PublicServiceStatus = Readonly<{
  status: PublicServiceState;
  components: Readonly<{
    api: "operational";
    marketData: PublicServiceState;
  }>;
  updatedAt: string | null;
  message: string;
}>;

export interface ServiceStatusKvStore {
  get(key: string, type: "json"): Promise<unknown>;
  put(
    key: string,
    value: string,
    options: Readonly<{ expiration: number }>,
  ): Promise<void>;
}

export interface ServiceStatusRepository {
  read(): Promise<ServiceStatusRecord | undefined>;
  recordMarketData(
    status: StoredMarketDataStatus,
    checkedAt: Date,
  ): Promise<void>;
}

const RECORD_TTL_SECONDS = 24 * 60 * 60;
const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1_000;

export class ServiceStatusStore implements ServiceStatusRepository {
  readonly #kv: ServiceStatusKvStore;
  readonly #logger: Logger;

  constructor(kv: ServiceStatusKvStore, logger: Logger) {
    this.#kv = kv;
    this.#logger = logger;
  }

  async read(): Promise<ServiceStatusRecord | undefined> {
    const raw: unknown = await this.#kv.get(SERVICE_STATUS_KEY, "json");
    if (raw === null) return undefined;
    const parsed = serviceStatusRecordSchema.safeParse(raw);
    if (parsed.success) return parsed.data;
    this.#logger.warn("invalid_service_status_record", {
      cacheKey: SERVICE_STATUS_KEY,
    });
    return undefined;
  }

  async recordMarketData(
    status: StoredMarketDataStatus,
    checkedAt: Date,
  ): Promise<void> {
    const record = serviceStatusRecordSchema.parse({
      schemaVersion: 1,
      marketData: status,
      checkedAt: checkedAt.toISOString(),
    });
    await this.#kv.put(SERVICE_STATUS_KEY, JSON.stringify(record), {
      expiration: Math.floor(checkedAt.getTime() / 1_000) + RECORD_TTL_SECONDS,
    });
  }
}

export function marketDataStatusForError(
  error: unknown,
): StoredMarketDataStatus | undefined {
  if (error instanceof ProviderAuthenticationError) return "unavailable";
  if (error instanceof ProviderRateLimitError || error instanceof ProviderError)
    return "degraded";
  return undefined;
}

function statusMessage(status: PublicServiceState): string {
  switch (status) {
    case "operational":
      return "The API and market data are operating normally.";
    case "degraded":
      return "New market data may be delayed. Cached charts may remain available.";
    case "unavailable":
      return "New market data is currently unavailable. Cached charts may remain available.";
    case "unknown":
      return "Market data status has not been checked recently.";
  }
}

export function toPublicServiceStatus(
  record: ServiceStatusRecord | undefined,
  now = new Date(),
): PublicServiceStatus {
  const checkedAt =
    record === undefined ? undefined : Date.parse(record.checkedAt);
  const age = checkedAt === undefined ? undefined : now.getTime() - checkedAt;
  const marketData: PublicServiceState =
    record === undefined ||
    age === undefined ||
    age > STATUS_OBSERVATION_MAX_AGE_MS ||
    age < -CLOCK_SKEW_TOLERANCE_MS
      ? "unknown"
      : record.marketData;

  return {
    status: marketData,
    components: { api: "operational", marketData },
    updatedAt: record?.checkedAt ?? null,
    message: statusMessage(marketData),
  };
}
