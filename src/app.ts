import { Hono } from "hono";
import { MarketDataCache } from "./cache/data-cache";
import {
  INTERNAL_BROWSER_MAX_AGE_HEADER,
  INTERNAL_CACHE_STATE_HEADER,
  INTERNAL_FRESH_UNTIL_HEADER,
  ResponseArtifactCache,
  restoreCachedBrowserMaxAge,
} from "./cache/response-cache";
import { createResponseCacheKey } from "./cache/keys";
import { readConfig, type AppConfig } from "./config";
import {
  MethodNotAllowedError,
  ProviderError,
  type PublicError,
  toPublicError,
} from "./domain/errors";
import type { MarketDataProvider } from "./domain/market-series";
import type { OutputFormat } from "./domain/request";
import { createErrorResponse } from "./http/error-response";
import { enforceClientRateLimit } from "./http/client-rate-limit";
import {
  corsPreflightResponse,
  JSON_CONTENT_TYPE,
  SVG_CONTENT_TYPE,
  withApiHeaders,
  withoutBody,
} from "./http/headers";
import { parseSparklineRequest, requestedOutputMode } from "./http/query";
import { LseProvider } from "./providers/lse/adapter";
import {
  createStrongEtag,
  renderSparkline,
  renderSparklineJson,
} from "./render/renderer";
import { loadSeries } from "./services/series";
import {
  ServiceStatusStore,
  toPublicServiceStatus,
  type ServiceStatusRepository,
} from "./status/service-status";
import { errorLogFields, logger, type Logger } from "./telemetry/logger";

type Bindings = { Bindings: Env };

export type AppFactories = Readonly<{
  now(): Date;
  logger: Logger;
  createProvider(env: Env, config: AppConfig): MarketDataProvider;
  createDataCache(env: Env): MarketDataCache;
  createResponseCache(): ResponseArtifactCache;
  createStatusStore(env: Env): ServiceStatusRepository;
}>;

const defaultFactories: AppFactories = {
  now: () => new Date(),
  logger,
  createProvider(_env, config) {
    return new LseProvider({
      apiKey: config.providerApiKey,
      baseUrl: config.providerBaseUrl,
    });
  },
  createDataCache(env) {
    return new MarketDataCache(env.MARKET_DATA_CACHE, {
      warn: (fields) => logger.warn("market_data_cache_warning", fields),
    });
  },
  createResponseCache() {
    const workerCaches = caches as CacheStorage & { readonly default: Cache };
    return new ResponseArtifactCache(workerCaches.default);
  },
  createStatusStore(env) {
    return new ServiceStatusStore(env.MARKET_DATA_CACHE, logger);
  },
};

function publicCacheControl(
  browserSeconds: number,
  freshUntil: Date,
  staleSeconds: number,
  now: Date,
): string {
  const sharedSeconds = Math.max(
    0,
    Math.floor((freshUntil.getTime() - now.getTime()) / 1_000),
  );
  return [
    "public",
    `max-age=${Math.min(browserSeconds, sharedSeconds)}`,
    `s-maxage=${sharedSeconds}`,
    `stale-while-revalidate=${staleSeconds}`,
    `stale-if-error=${staleSeconds}`,
  ].join(", ");
}

function stripInternalHeaders(
  response: Response,
  cacheState: "HIT" | "MISS" | "STALE",
): Response {
  const headers = new Headers(response.headers);
  restoreCachedBrowserMaxAge(headers);
  headers.delete(INTERNAL_BROWSER_MAX_AGE_HEADER);
  headers.delete(INTERNAL_FRESH_UNTIL_HEADER);
  headers.delete(INTERNAL_CACHE_STATE_HEADER);
  headers.set("X-Cache", cacheState);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function conditionalResponse(request: Request, response: Response): Response {
  const etag = response.headers.get("ETag");
  if (etag === null || request.headers.get("If-None-Match") !== etag)
    return response;
  return new Response(null, { status: 304, headers: response.headers });
}

async function renderSuccess(
  request: ReturnType<typeof parseSparklineRequest>,
  series: Awaited<ReturnType<typeof loadSeries>>,
  now: Date,
): Promise<Response> {
  const svg = renderSparkline(series.series.points, {
    width: 160,
    height: 48,
    theme: request.theme,
    fill: request.fill,
    ticker: request.ticker,
    timeframe: request.timeframe,
    referenceClose: series.series.referenceClose,
  });
  const body =
    request.format === "svg"
      ? svg
      : renderSparklineJson(series.series, request, svg);
  const headers = new Headers({
    "Cache-Control":
      series.cacheState === "STALE"
        ? "public, max-age=0, s-maxage=60"
        : publicCacheControl(
            series.freshness.browserMaxAgeSeconds,
            series.freshUntil,
            series.freshness.staleForSeconds,
            now,
          ),
    "Content-Type":
      request.format === "svg" ? SVG_CONTENT_TYPE : JSON_CONTENT_TYPE,
    ETag: await createStrongEtag(body),
    "X-Data-As-Of": series.series.dataAsOf,
    "X-Cache": series.cacheState,
  });
  return new Response(body, { headers });
}

export function createApp(
  overrides: Partial<AppFactories> = {},
): Hono<Bindings> {
  const factories: AppFactories = { ...defaultFactories, ...overrides };
  const app = new Hono<Bindings>();

  app.options("/status", () => corsPreflightResponse(crypto.randomUUID()));

  app.on(["GET", "HEAD"], "/status", async (c) => {
    const requestId = crypto.randomUUID();
    let record: Awaited<ReturnType<ServiceStatusRepository["read"]>>;
    try {
      record = await factories.createStatusStore(c.env).read();
    } catch (error) {
      factories.logger.warn("service_status_read_failed", {
        requestId,
        ...errorLogFields(error),
      });
      record = undefined;
    }
    const response = withApiHeaders(
      Response.json(toPublicServiceStatus(record, factories.now()), {
        headers: {
          "Cache-Control": "public, max-age=15, s-maxage=30, stale-if-error=60",
        },
      }),
      requestId,
    );
    return c.req.method === "HEAD" ? withoutBody(response) : response;
  });

  app.all("/status", async () => {
    const requestId = crypto.randomUUID();
    const response = await createErrorResponse(
      toPublicError(new MethodNotAllowedError()),
      "json",
      requestId,
    );
    response.headers.set("Allow", "GET, HEAD, OPTIONS");
    return withApiHeaders(response, requestId);
  });

  app.on(["GET", "HEAD"], "/health", (c) => {
    const requestId = crypto.randomUUID();
    const response = withApiHeaders(
      Response.json(
        { status: "ok" },
        { headers: { "Cache-Control": "no-store" } },
      ),
      requestId,
    );
    return c.req.method === "HEAD" ? withoutBody(response) : response;
  });

  app.all("/health", async () => {
    const requestId = crypto.randomUUID();
    const response = await createErrorResponse(
      toPublicError(new MethodNotAllowedError()),
      "json",
      requestId,
    );
    response.headers.set("Allow", "GET, HEAD");
    return withApiHeaders(response, requestId);
  });

  app.options("/v1/*", () => corsPreflightResponse(crypto.randomUUID()));

  app.on(["GET", "HEAD"], "/v1/sparkline", async (c) => {
    const startedAt = Date.now();
    const requestId = crypto.randomUUID();
    const mode = requestedOutputMode(new URL(c.req.url));
    let response: Response;
    let canonicalRequest: ReturnType<typeof parseSparklineRequest> | undefined;
    let semanticError: PublicError | undefined;
    try {
      const limitKey = c.req.header("CF-Connecting-IP") ?? "anonymous";
      await enforceClientRateLimit(
        c.env.SPARKLINE_BURST_RATE_LIMITER,
        c.env.SPARKLINE_RATE_LIMITER,
        limitKey,
      );

      const request = parseSparklineRequest(c.req.raw);
      canonicalRequest = request;
      const config = readConfig(c.env);
      const responseCache = factories.createResponseCache();
      const responseKey = createResponseCacheKey(request, {
        rendererVersion: config.rendererVersion,
        normalizationVersion: config.normalizationVersion,
      });
      const cachedResponse = await responseCache.match(
        responseKey,
        factories.now(),
      );
      if (cachedResponse !== undefined) {
        response = stripInternalHeaders(cachedResponse, "HIT");
      } else {
        const now = factories.now();
        const series = await loadSeries({
          request,
          requestId,
          config,
          cache: factories.createDataCache(c.env),
          provider: factories.createProvider(c.env, config),
          now,
          signal: c.req.raw.signal,
          logger: factories.logger,
          waitUntil: (promise) => c.executionCtx.waitUntil(promise),
          statusReporter: factories.createStatusStore(c.env),
        });
        response = await renderSuccess(request, series, now);
        if (series.cacheState !== "STALE") {
          c.executionCtx.waitUntil(
            responseCache
              .put(
                responseKey,
                response.clone(),
                { freshUntil: series.freshUntil, state: "FRESH" },
                now,
              )
              .catch((error: unknown) => {
                factories.logger.warn("response_cache_write_failed", {
                  requestId,
                  errorType:
                    error instanceof Error ? error.name : "UnknownError",
                });
              }),
          );
        }
      }
      response = conditionalResponse(
        c.req.raw,
        withApiHeaders(response, requestId),
      );
    } catch (error) {
      semanticError = toPublicError(error);
      const failureFields = {
        requestId,
        method: c.req.method,
        path: c.req.path,
        outcome: mode === "svg" ? "fallback" : "json_error",
        semanticStatus: semanticError.status,
        errorCode: semanticError.code,
        durationMs: Date.now() - startedAt,
        ticker: canonicalRequest?.ticker,
        timeframe: canonicalRequest?.timeframe,
        theme: canonicalRequest?.theme,
        fill: canonicalRequest?.fill,
        format: canonicalRequest?.format,
        providerStatus:
          error instanceof ProviderError ? error.providerStatus : undefined,
        providerAttempt:
          error instanceof ProviderError ? error.attempt : undefined,
        ...errorLogFields(error),
      };
      if (semanticError.status >= 500) {
        factories.logger.error("request_failed", failureFields);
      } else {
        factories.logger.warn("request_failed", failureFields);
      }
      response = withApiHeaders(
        await createErrorResponse(semanticError, mode, requestId),
        requestId,
      );
    }

    const fallbackErrorCode = response.headers.get("X-Error-Code");
    factories.logger.info("request_complete", {
      requestId,
      method: c.req.method,
      path: c.req.path,
      status: response.status,
      semanticStatus:
        semanticError?.status ??
        (fallbackErrorCode === null
          ? response.status
          : Number(response.headers.get("X-Error-Status"))),
      outcome:
        fallbackErrorCode !== null
          ? "fallback"
          : response.status >= 400
            ? "json_error"
            : "chart",
      errorCode: semanticError?.code ?? fallbackErrorCode ?? undefined,
      cache: response.headers.get("X-Cache"),
      durationMs: Date.now() - startedAt,
      ticker: canonicalRequest?.ticker,
      timeframe: canonicalRequest?.timeframe,
      theme: canonicalRequest?.theme,
      fill: canonicalRequest?.fill,
      format: canonicalRequest?.format,
    });
    return c.req.method === "HEAD" ? withoutBody(response) : response;
  });

  app.all("/v1/sparkline", async (c) => {
    const requestId = crypto.randomUUID();
    const mode: OutputFormat | "invalid" = requestedOutputMode(
      new URL(c.req.url),
    );
    const response = await createErrorResponse(
      toPublicError(new MethodNotAllowedError()),
      mode,
      requestId,
    );
    response.headers.set("Allow", "GET, HEAD, OPTIONS");
    return withApiHeaders(response, requestId);
  });

  return app;
}
