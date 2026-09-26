import { describe, expect, it, vi } from "vitest";
import { readConfig } from "../../src/config";
import type { MarketSeriesRequest } from "../../src/domain/market-series";
import {
  createProviderChain,
  DEFAULT_PROVIDER_ORDER,
  parseProviderOrder,
  ProviderConfigurationError,
} from "../../src/providers/registry";
import lseAapl from "../fixtures/provider/lse-aapl.json";
import siftingAapl from "../fixtures/provider/sifting-aapl.json";

const baseEnv = {
  APP_ENV: "staging",
  PROVIDER_VERSION: "v1",
  SIFTING_BASE_URL: "https://sifting.example.test",
  LSE_BASE_URL: "https://lse.example.test",
  CACHE_POLICY_VERSION: "v1",
  NORMALIZATION_VERSION: "v5",
  RENDERER_VERSION: "v4",
  SIFTING_API_KEY: "fixture-sifting-key",
  LSE_API_KEY: "fixture-lse-key",
};

function envWith(overrides: Record<string, string | undefined>): Env {
  return { ...baseEnv, ...overrides } as unknown as Env;
}

const context = {
  requestId: "request-1",
  signal: new AbortController().signal,
};

const stockRequest: MarketSeriesRequest = {
  ticker: "AAPL",
  market: "stock",
  start: new Date("2026-07-01T00:00:00.000Z"),
  end: new Date("2026-07-31T00:00:00.000Z"),
  interval: "1d",
};

const indexRequest: MarketSeriesRequest = {
  ...stockRequest,
  ticker: "NAS100/USD",
  market: "index",
};

const silentLogger = { info() {}, warn() {}, error() {} };

/** Route stubbed provider traffic by host and record the order of calls. */
function routedFetch(routes: Record<string, () => Response>): {
  fetch: typeof fetch;
  hosts: string[];
} {
  const hosts: string[] = [];
  const stub: typeof fetch = (input) => {
    const host = new URL(new Request(input).url).host;
    hosts.push(host);
    const route = routes[host];
    if (route === undefined) throw new Error(`Unexpected host ${host}`);
    return Promise.resolve(route());
  };
  return { fetch: vi.fn(stub), hosts };
}

describe("parseProviderOrder", () => {
  it("defaults to LSE first, then Sifting", () => {
    expect(DEFAULT_PROVIDER_ORDER).toEqual(["lse", "sifting"]);
    expect(parseProviderOrder(undefined)).toEqual(["lse", "sifting"]);
  });

  it.each(["", "  ", ",", " , "])(
    "falls back to the default for empty value %j",
    (value) => {
      expect(parseProviderOrder(value)).toEqual(DEFAULT_PROVIDER_ORDER);
    },
  );

  it("respects a swapped order and tolerates whitespace and case", () => {
    expect(parseProviderOrder(" Sifting , LSE ")).toEqual(["sifting", "lse"]);
    expect(parseProviderOrder("lse")).toEqual(["lse"]);
  });

  it("fails fast on unknown provider names", () => {
    expect(() => parseProviderOrder("lse,polygon")).toThrow(
      ProviderConfigurationError,
    );
    expect(() => parseProviderOrder("lse,polygon")).toThrow(
      /Unknown provider "polygon" in PROVIDER_ORDER.*lse, sifting/,
    );
  });

  it("rejects duplicate provider names", () => {
    expect(() => parseProviderOrder("lse,sifting,lse")).toThrow(
      /Duplicate provider "lse"/,
    );
  });
});

describe("readConfig provider order", () => {
  it("uses the default order and derives the cache provider id from it", () => {
    const config = readConfig(envWith({}));
    expect(config.providerOrder).toEqual(["lse", "sifting"]);
    expect(config.providerId).toBe("lse-sifting");
  });

  it("reads a swapped PROVIDER_ORDER", () => {
    const config = readConfig(envWith({ PROVIDER_ORDER: "sifting,lse" }));
    expect(config.providerOrder).toEqual(["sifting", "lse"]);
    expect(config.providerId).toBe("sifting-lse");
  });

  it("fails fast on an unknown provider name", () => {
    expect(() => readConfig(envWith({ PROVIDER_ORDER: "lse,nope" }))).toThrow(
      ProviderConfigurationError,
    );
  });

  it("only requires API keys for configured providers", () => {
    const config = readConfig(
      envWith({ PROVIDER_ORDER: "lse", SIFTING_API_KEY: undefined }),
    );
    expect(config.providerOrder).toEqual(["lse"]);
    expect(() =>
      readConfig(envWith({ PROVIDER_ORDER: "lse,sifting", LSE_API_KEY: "" })),
    ).toThrow(/LSE_API_KEY is required because PROVIDER_ORDER includes "lse"/);
  });
});

describe("createProviderChain", () => {
  it("calls LSE first for stocks by default", async () => {
    const { fetch, hosts } = routedFetch({
      "lse.example.test": () => Response.json(lseAapl),
      "sifting.example.test": () => Response.json(siftingAapl),
    });
    const chain = createProviderChain(readConfig(envWith({})), {
      logger: silentLogger,
      fetch,
    });

    expect(chain.id).toBe("lse-sifting");
    await chain.fetchSeries(stockRequest, context);
    expect(hosts).toEqual(["lse.example.test"]);
  });

  it("calls Sifting first when the order is swapped", async () => {
    const { fetch, hosts } = routedFetch({
      "lse.example.test": () => Response.json(lseAapl),
      "sifting.example.test": () => Response.json(siftingAapl),
    });
    const chain = createProviderChain(
      readConfig(envWith({ PROVIDER_ORDER: "sifting,lse" })),
      { logger: silentLogger, fetch },
    );

    await chain.fetchSeries(stockRequest, context);
    expect(hosts).toEqual(["sifting.example.test"]);
  });

  it("serves indices from LSE whichever order is configured", async () => {
    for (const order of ["lse,sifting", "sifting,lse"]) {
      const { fetch, hosts } = routedFetch({
        "lse.example.test": () => Response.json(lseAapl),
        "sifting.example.test": () => Response.json(siftingAapl),
      });
      const chain = createProviderChain(
        readConfig(envWith({ PROVIDER_ORDER: order })),
        { logger: silentLogger, fetch },
      );
      await chain.fetchSeries(indexRequest, context);
      expect(hosts).toEqual(["lse.example.test"]);
    }
  });

  it("falls back from a rejected LSE key to Sifting for stocks", async () => {
    const { fetch, hosts } = routedFetch({
      "lse.example.test": () =>
        Response.json({ detail: "api key inactive" }, { status: 403 }),
      "sifting.example.test": () => Response.json(siftingAapl),
    });
    const chain = createProviderChain(readConfig(envWith({})), {
      logger: silentLogger,
      fetch,
    });

    const series = await chain.fetchSeries(stockRequest, context);
    expect(series.resolvedTicker).toBe("AAPL");
    expect(hosts).toEqual(["lse.example.test", "sifting.example.test"]);
  });
});
