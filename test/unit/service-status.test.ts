import { describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app";
import {
  ProviderAuthenticationError,
  ProviderError,
  ProviderNotFoundError,
  ProviderRateLimitError,
} from "../../src/domain/errors";
import {
  SERVICE_STATUS_KEY,
  ServiceStatusStore,
  marketDataStatusForError,
  toPublicServiceStatus,
  type ServiceStatusKvStore,
  type ServiceStatusRecord,
  type ServiceStatusRepository,
} from "../../src/status/service-status";

class MemoryStatusKv implements ServiceStatusKvStore {
  readonly values = new Map<string, string>();
  expiration: number | undefined;

  async get(key: string, _type: "json"): Promise<unknown> {
    const value = this.values.get(key);
    return value === undefined ? null : JSON.parse(value);
  }

  async put(
    key: string,
    value: string,
    options: Readonly<{ expiration: number }>,
  ): Promise<void> {
    this.values.set(key, value);
    this.expiration = options.expiration;
  }
}

const silentLogger = { info() {}, warn() {}, error() {} };

describe("service status", () => {
  it("stores only the coarse market-data state and observation time", async () => {
    const kv = new MemoryStatusKv();
    const store = new ServiceStatusStore(kv, silentLogger);
    const checkedAt = new Date("2026-07-13T21:00:00.000Z");

    await store.recordMarketData("operational", checkedAt);

    await expect(store.read()).resolves.toEqual({
      schemaVersion: 1,
      marketData: "operational",
      checkedAt: checkedAt.toISOString(),
    });
    expect([...kv.values.keys()]).toEqual([SERVICE_STATUS_KEY]);
    expect(kv.expiration).toBe(
      Math.floor(checkedAt.getTime() / 1_000) + 24 * 60 * 60,
    );
  });

  it("treats missing, invalid, and old observations as unknown", async () => {
    const warn = vi.fn();
    const kv = new MemoryStatusKv();
    const store = new ServiceStatusStore(kv, {
      info() {},
      warn,
      error() {},
    });

    await expect(store.read()).resolves.toBeUndefined();
    kv.values.set(SERVICE_STATUS_KEY, JSON.stringify({ status: "secret" }));
    await expect(store.read()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith("invalid_service_status_record", {
      cacheKey: SERVICE_STATUS_KEY,
    });

    const stale: ServiceStatusRecord = {
      schemaVersion: 1,
      marketData: "operational",
      checkedAt: "2026-07-13T20:00:00.000Z",
    };
    expect(
      toPublicServiceStatus(stale, new Date("2026-07-13T21:00:01.000Z")),
    ).toEqual({
      status: "unknown",
      components: { api: "operational", marketData: "unknown" },
      updatedAt: stale.checkedAt,
      message: "Market data status has not been checked recently.",
    });
  });

  it("classifies only provider-wide failures", () => {
    expect(marketDataStatusForError(new ProviderAuthenticationError())).toBe(
      "unavailable",
    );
    expect(marketDataStatusForError(new ProviderRateLimitError())).toBe(
      "degraded",
    );
    expect(marketDataStatusForError(new ProviderError())).toBe("degraded");
    expect(
      marketDataStatusForError(new ProviderNotFoundError()),
    ).toBeUndefined();
  });

  it("serves the public aggregate without provider details", async () => {
    const record: ServiceStatusRecord = {
      schemaVersion: 1,
      marketData: "degraded",
      checkedAt: "2026-07-13T21:00:00.000Z",
    };
    const repository: ServiceStatusRepository = {
      async read() {
        return record;
      },
      async recordMarketData() {},
    };
    const app = createApp({
      now: () => new Date("2026-07-13T21:10:00.000Z"),
      createStatusStore: () => repository,
    });

    const response = await app.request("https://ticker-line.test/status");

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=15, s-maxage=30, stale-if-error=60",
    );
    expect(response.headers.get("X-Request-Id")).toBeTruthy();
    await expect(response.json()).resolves.toEqual({
      status: "degraded",
      components: { api: "operational", marketData: "degraded" },
      updatedAt: record.checkedAt,
      message:
        "New market data may be delayed. Cached charts may remain available.",
    });
  });
});
