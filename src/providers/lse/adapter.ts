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
  AssetType,
  MarketDataProvider,
  MarketPoint,
  MarketSeries,
  MarketSeriesRequest,
  ProviderRequestContext,
} from "../../domain/market-series";
import {
  PROVIDER_MAX_RAW_POINTS,
  PROVIDER_REQUEST_TIMEOUT_MS,
  PROVIDER_RESPONSE_MAX_BYTES,
} from "../provider";
import { lseCandlesSchema, type LseCandle } from "./schema";
import { inferLseAssetMetadata, toLseSymbol } from "./symbols";

export type LseProviderOptions = Readonly<{
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxAttempts?: 1 | 2;
}>;

const UTC_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?$/;

/** Parse LSE's timezone-less candle label explicitly as UTC. */
export function parseLseUtcTimestamp(value: string): number | undefined {
  const match = UTC_TIMESTAMP.exec(value);
  if (match === null) return undefined;
  const [
    ,
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
    fraction = "",
  ] = match;
  if (
    yearText === undefined ||
    monthText === undefined ||
    dayText === undefined ||
    hourText === undefined ||
    minuteText === undefined ||
    secondText === undefined
  ) {
    return undefined;
  }
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const millisecond = Number(fraction.padEnd(3, "0").slice(0, 3));
  const timestamp = Date.UTC(
    year,
    month - 1,
    day,
    hour,
    minute,
    second,
    millisecond,
  );
  const parsed = new Date(timestamp);
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day ||
    parsed.getUTCHours() !== hour ||
    parsed.getUTCMinutes() !== minute ||
    parsed.getUTCSeconds() !== second
  ) {
    return undefined;
  }
  return timestamp;
}

export async function readBoundedBody(
  response: Response,
  maximumBytes = PROVIDER_RESPONSE_MAX_BYTES,
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new TypeError("maximumBytes must be a positive safe integer.");
  }
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && Number(declaredLength) > maximumBytes) {
    await response.body?.cancel();
    throw new ProviderSchemaError(
      "Provider response exceeded the configured byte limit.",
    );
  }
  if (response.body === null) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      length += result.value.byteLength;
      if (length > maximumBytes) {
        await reader.cancel("response too large");
        throw new ProviderSchemaError(
          "Provider response exceeded the configured byte limit.",
        );
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function parseRetryAfter(
  value: string | null,
  now = Date.now(),
): number | undefined {
  if (value === null) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return undefined;
  return Math.max(0, Math.ceil((date - now) / 1_000));
}

function normalizeRows(
  rows: readonly LseCandle[],
  requestedTicker: string,
  providerSymbol: string,
): MarketSeries {
  const byTimestamp = new Map<number, MarketPoint>();
  let resolvedTicker = requestedTicker;
  for (const row of rows) {
    const timestamp = parseLseUtcTimestamp(row.ts);
    const close = typeof row.close === "number" ? row.close : Number(row.close);
    if (timestamp === undefined || !Number.isFinite(close)) continue;
    byTimestamp.set(timestamp, { timestamp, close });
    if (row.symbol.length > 0)
      resolvedTicker =
        row.symbol === providerSymbol ? requestedTicker : row.symbol;
  }
  const points = [...byTimestamp.values()].sort(
    (a, b) => a.timestamp - b.timestamp,
  );
  const latest = points.at(-1);
  if (latest === undefined) throw new InsufficientDataError();

  const metadata = inferLseAssetMetadata(providerSymbol);
  const base: {
    resolvedTicker: string;
    assetType: AssetType;
    currency?: string;
    dataAsOf: string;
    points: readonly MarketPoint[];
  } = {
    resolvedTicker,
    assetType: metadata.assetType,
    dataAsOf: new Date(latest.timestamp).toISOString(),
    points,
  };
  if (metadata.currency !== undefined) base.currency = metadata.currency;
  return base;
}

function buildCandlesUrl(
  baseUrl: string,
  request: MarketSeriesRequest,
  symbol: string,
): URL {
  const url = new URL(`${baseUrl.replace(/\/$/, "")}/candles`);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("timeframe", request.interval);
  url.searchParams.set("start", request.start.toISOString().slice(0, 10));
  url.searchParams.set("end", request.end.toISOString().slice(0, 10));
  url.searchParams.set("order", "asc");
  url.searchParams.set("limit", String(PROVIDER_MAX_RAW_POINTS));
  return url;
}

export class LseProvider implements MarketDataProvider {
  readonly id = "lse";
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  readonly #maxResponseBytes: number;
  readonly #maxAttempts: 1 | 2;

  constructor(options: LseProviderOptions) {
    if (options.apiKey.length === 0)
      throw new TypeError("LSE API key is required.");
    this.#apiKey = options.apiKey;
    this.#baseUrl =
      options.baseUrl ?? "https://api.londonstrategicedge.com/vault";
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
    const providerSymbol = toLseSymbol(request.ticker);
    const url = buildCandlesUrl(this.#baseUrl, request, providerSymbol);
    const deadline = Date.now() + this.#timeoutMs;
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
          headers: { "x-api-key": this.#apiKey, accept: "application/json" },
          signal: controller.signal,
        });
        if (response.status === 401 || response.status === 403) {
          throw new ProviderAuthenticationError(undefined, {
            providerStatus: response.status,
            attempt,
          });
        }
        if (response.status === 404) throw new ProviderNotFoundError();
        if (response.status === 422) {
          throw new ProviderSchemaError(
            "The provider rejected the candle request.",
            { providerStatus: response.status, attempt },
          );
        }
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
        if (!response.ok)
          throw new ProviderSchemaError(
            "Unexpected provider response status.",
            {
              providerStatus: response.status,
              attempt,
            },
          );

        const bytes = await readBoundedBody(response, this.#maxResponseBytes);
        let payload: unknown;
        try {
          payload = JSON.parse(new TextDecoder().decode(bytes));
        } catch (error) {
          throw new ProviderSchemaError("Provider returned malformed JSON.", {
            cause: error,
          });
        }
        const parsed = lseCandlesSchema.safeParse(payload);
        if (!parsed.success)
          throw new ProviderSchemaError(
            "Provider returned an invalid candle payload.",
          );
        if (parsed.data.length === 0) throw new InsufficientDataError();
        return normalizeRows(parsed.data, request.ticker, providerSymbol);
      } catch (error) {
        if (
          error instanceof ProviderError ||
          error instanceof ProviderNotFoundError ||
          error instanceof ProviderRateLimitError ||
          error instanceof InsufficientDataError
        ) {
          throw error;
        }
        if (context.signal.aborted)
          throw new ProviderTimeoutError("Provider request was aborted.", {
            cause: error,
            attempt,
          });
        if (controller.signal.aborted || Date.now() >= deadline) {
          throw new ProviderTimeoutError(undefined, { cause: error, attempt });
        }
        lastError = error;
        if (attempt >= this.#maxAttempts)
          throw new ProviderError(undefined, { cause: error, attempt });
      } finally {
        clearTimeout(timer);
        context.signal.removeEventListener("abort", onAbort);
      }
    }
    throw new ProviderError(undefined, { cause: lastError });
  }
}
