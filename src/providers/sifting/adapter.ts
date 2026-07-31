import {
  InsufficientDataError,
  ProviderAuthenticationError,
  ProviderError,
  ProviderNotFoundError,
  ProviderRateLimitError,
  ProviderSchemaError,
  ProviderTimeoutError,
} from "../../domain/errors";
import type {
  MarketDataProvider,
  MarketPoint,
  MarketSeries,
  MarketSeriesRequest,
  ProviderRequestContext,
} from "../../domain/market-series";
import type { SourceInterval } from "../../domain/timeframe";
import { parseRetryAfter, readBoundedBody } from "../http";
import {
  PROVIDER_REQUEST_TIMEOUT_MS,
  PROVIDER_RESPONSE_MAX_BYTES,
} from "../provider";
import { siftingBarsSchema, type SiftingBars } from "./schema";
import {
  toSiftingSymbol,
  type SiftingMarket,
  type SiftingSymbol,
} from "./symbols";

export type SiftingProviderOptions = Readonly<{
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxAttempts?: 1 | 2;
}>;

const MARKET_LIMITS: Readonly<Record<SiftingMarket, number>> = {
  stocks: 2_000,
  forex: 2_000,
  crypto: 5_000,
  commodities: 2_000,
};

function toSiftingInterval(
  market: SiftingMarket,
  interval: SourceInterval,
): Exclude<SourceInterval, "1w"> | "1w" {
  return interval === "1w" && market !== "stocks" ? "1d" : interval;
}

function buildBarsUrl(
  baseUrl: string,
  request: MarketSeriesRequest,
  resolved: SiftingSymbol,
): URL {
  const symbol = encodeURIComponent(resolved.symbol);
  const url = new URL(
    `${baseUrl.replace(/\/$/, "")}/v1/hist/${resolved.market}/${symbol}/bars`,
  );
  url.searchParams.set("start", request.start.toISOString());
  url.searchParams.set("end", request.end.toISOString());
  url.searchParams.set(
    "interval",
    toSiftingInterval(resolved.market, request.interval),
  );
  url.searchParams.set("limit", String(MARKET_LIMITS[resolved.market]));
  return url;
}

function normalizePayloads(
  payloads: readonly SiftingBars[],
  requestedTicker: string,
  resolved: SiftingSymbol,
): MarketSeries {
  const byTimestamp = new Map<number, MarketPoint>();
  for (const payload of payloads) {
    for (const row of payload.data) {
      if (!Number.isFinite(row.t) || !Number.isFinite(row.c)) continue;
      byTimestamp.set(row.t, { timestamp: row.t, close: row.c });
      if (byTimestamp.size > 5_000) {
        throw new ProviderSchemaError(
          "Provider returned too many points for a bounded sparkline request.",
        );
      }
    }
  }
  const points = [...byTimestamp.values()].sort(
    (left, right) => left.timestamp - right.timestamp,
  );
  const latest = points.at(-1);
  if (latest === undefined) throw new InsufficientDataError();
  return {
    resolvedTicker: requestedTicker,
    assetType: resolved.assetType,
    ...(resolved.currency === undefined ? {} : { currency: resolved.currency }),
    ...(resolved.market === "stocks"
      ? { timezone: "America/New_York" }
      : { timezone: "UTC" }),
    dataAsOf: new Date(latest.timestamp).toISOString(),
    referenceClose: points[0]?.close ?? latest.close,
    points,
  };
}

export class SiftingProvider implements MarketDataProvider {
  readonly id = "sifting";
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  readonly #maxResponseBytes: number;
  readonly #maxAttempts: 1 | 2;

  constructor(options: SiftingProviderOptions) {
    if (options.apiKey.length === 0)
      throw new TypeError("Sifting API key is required.");
    this.#apiKey = options.apiKey;
    this.#baseUrl = options.baseUrl ?? "https://api.sifting.io";
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#timeoutMs = options.timeoutMs ?? PROVIDER_REQUEST_TIMEOUT_MS;
    this.#maxResponseBytes =
      options.maxResponseBytes ?? PROVIDER_RESPONSE_MAX_BYTES;
    this.#maxAttempts = options.maxAttempts ?? 2;
  }

  async fetchSeries(
    request: MarketSeriesRequest,
    context: ProviderRequestContext,
  ): Promise<MarketSeries> {
    const resolved = toSiftingSymbol(request.ticker, request.market);
    if (resolved === undefined) throw new ProviderNotFoundError();
    const initialUrl = buildBarsUrl(this.#baseUrl, request, resolved);
    const deadline = Date.now() + this.#timeoutMs;
    const payloads: SiftingBars[] = [];
    let totalBytes = 0;
    let url = initialUrl;

    for (let page = 1; page <= 3; page += 1) {
      const remainingBytes = this.#maxResponseBytes - totalBytes;
      if (remainingBytes < 1) {
        throw new ProviderSchemaError(
          "Provider response exceeded the configured byte limit.",
        );
      }
      const result = await this.#fetchPage(
        url,
        context,
        deadline,
        remainingBytes,
      );
      totalBytes += result.byteLength;
      payloads.push(result.payload);
      const cursor = result.payload.meta.next_cursor;
      if (cursor === undefined) {
        return normalizePayloads(payloads, request.ticker, resolved);
      }
      if (page === 3) {
        throw new ProviderSchemaError(
          "Provider pagination exceeded the configured page limit.",
        );
      }
      url = new URL(initialUrl);
      url.searchParams.delete("start");
      url.searchParams.set("cursor", cursor);
    }
    throw new ProviderSchemaError(
      "Provider pagination did not produce a complete response.",
    );
  }

  async #fetchPage(
    url: URL,
    context: ProviderRequestContext,
    deadline: number,
    maximumBytes: number,
  ): Promise<Readonly<{ payload: SiftingBars; byteLength: number }>> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.#maxAttempts; attempt += 1) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new ProviderTimeoutError();
      const controller = new AbortController();
      const onAbort = (): void => controller.abort(context.signal.reason);
      if (context.signal.aborted) onAbort();
      context.signal.addEventListener("abort", onAbort, { once: true });
      const timer = setTimeout(
        () => controller.abort(new DOMException("Timed out", "TimeoutError")),
        remaining,
      );
      try {
        const response = await this.#fetch(url, {
          headers: {
            "x-api-key": this.#apiKey,
            accept: "application/json",
            "accept-encoding": "gzip",
          },
          signal: controller.signal,
        });
        if (response.status === 401 || response.status === 403) {
          throw new ProviderAuthenticationError(undefined, {
            providerStatus: response.status,
            attempt,
          });
        }
        if (response.status === 404) throw new ProviderNotFoundError();
        if (response.status === 422) throw new InsufficientDataError();
        if (response.status === 429) {
          const retryAfterSeconds = parseRetryAfter(
            response.headers.get("retry-after"),
          );
          throw new ProviderRateLimitError(
            "The market data provider rate limit was reached.",
            retryAfterSeconds === undefined ? undefined : { retryAfterSeconds },
          );
        }
        if (response.status >= 500) {
          await response.body?.cancel();
          lastError = new ProviderError(undefined, {
            providerStatus: response.status,
            attempt,
          });
          if (attempt < this.#maxAttempts && deadline - Date.now() > 0)
            continue;
          throw lastError;
        }
        if (!response.ok) {
          throw new ProviderSchemaError(
            "Unexpected provider response status.",
            { providerStatus: response.status, attempt },
          );
        }

        const bytes = await readBoundedBody(response, maximumBytes);
        let payload: unknown;
        try {
          payload = JSON.parse(new TextDecoder().decode(bytes));
        } catch (error) {
          throw new ProviderSchemaError("Provider returned malformed JSON.", {
            cause: error,
          });
        }
        const parsed = siftingBarsSchema.safeParse(payload);
        if (!parsed.success) {
          throw new ProviderSchemaError(
            "Provider returned an invalid bars payload.",
          );
        }
        return { payload: parsed.data, byteLength: bytes.byteLength };
      } catch (error) {
        if (
          error instanceof ProviderError ||
          error instanceof ProviderNotFoundError ||
          error instanceof ProviderRateLimitError ||
          error instanceof InsufficientDataError
        ) {
          throw error;
        }
        if (context.signal.aborted) {
          throw new ProviderTimeoutError("Provider request was aborted.", {
            cause: error,
            attempt,
          });
        }
        if (controller.signal.aborted || Date.now() >= deadline) {
          throw new ProviderTimeoutError(undefined, { cause: error, attempt });
        }
        lastError = error;
        if (attempt >= this.#maxAttempts) {
          throw new ProviderError(undefined, { cause: error, attempt });
        }
      } finally {
        clearTimeout(timer);
        context.signal.removeEventListener("abort", onAbort);
      }
    }
    throw new ProviderError(undefined, { cause: lastError });
  }
}
