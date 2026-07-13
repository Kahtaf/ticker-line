# Ticker Line — Implementation Specification

- **Status:** Build-ready draft
- **Product requirements:** [`docs/prd.md`](./prd.md)
- **Created:** 2026-07-12
- **Audience:** Implementation agents and maintainers

## 1. Purpose and authority

This document translates the locked product requirements into a concrete implementation plan. It is the starting point for building the service, not a replacement for the PRD.

When the documents disagree:

1. The PRD controls public behavior, scope, and product requirements.
2. This document controls internal architecture and implementation defaults.
3. Provider contract terms control what data may legally be stored and displayed.

An agent may improve an internal implementation detail when tests preserve the public contract. It must not expand the public API, change response semantics, add a provider, or weaken a launch gate without updating the relevant design document first.

## 2. Fixed implementation decisions

The initial implementation will use:

- Cloudflare Workers, ES modules, and TypeScript in strict mode.
- Hono for HTTP routing, middleware composition, and response handling.
- Zod for public query validation, provider response validation, and cached-value validation.
- Workers Static Assets for the generated marketing/documentation site.
- Astro in static-output mode for the website. Do not add the Cloudflare Astro adapter unless the site later needs server rendering.
- Workers KV for normalized market-series values and negative lookups.
- The Workers Cache API for generated SVG and JSON responses local to an edge location.
- A deterministic gray SVG fallback for SVG-mode errors so image embeds never collapse into a browser broken-image indicator.
- Native Web APIs for HTTP, hashing, UUIDs, streams, and abort signals.
- Vitest with Cloudflare's Workers pool for runtime and integration tests.
- Playwright for deployed-browser and embed tests.
- npm with a committed `package-lock.json`.

Do not add the following to the MVP without evidence that they are needed:

- React, Vue, or another client application framework.
- A database or ORM.
- Durable Objects.
- A queue or scheduled worker.
- A general-purpose charting library.
- A DOM implementation in the Worker.
- A runtime date library solely for formatting timestamps.
- A logging SDK when structured `console` output is sufficient.
- An automatic second-provider failover path.

## 3. Runtime and package baseline

Use the current active Node.js LTS release for local tooling and CI. Runtime application code must target Workers Web APIs rather than Node-only APIs, even with `nodejs_compat` enabled.

The versions below were current when this document was created. Install compatible versions, commit the lockfile, and upgrade intentionally rather than using unbounded `latest` ranges in `package.json`.

### Runtime dependencies

| Package | Baseline | Purpose |
| --- | --- | --- |
| `hono` | `^4.12.29` | Small Web Standards router and middleware layer. |
| `zod` | `^4.4.3` | Runtime validation and inferred TypeScript types. |
| `@hono/zod-validator` | `^0.8.0` | Connect validated Hono query inputs to Zod schemas. |

Keep the runtime dependency set this small unless a concrete implementation problem justifies another package.

### Development dependencies

| Package | Baseline | Purpose |
| --- | --- | --- |
| `typescript` | `^7.0.2` | Type checking. |
| `wrangler` | `^4.110.0` | Local Worker runtime, type generation, deployment, and secret management. |
| `astro` | `^7.0.7` | Static website generation. |
| `@astrojs/check` | `^0.9.9` | Type-check Astro templates from the standard check command. |
| `vitest` | `^4.1.10` | Unit, contract, and integration tests. |
| `@cloudflare/vitest-pool-workers` | `^0.18.4` | Run tests inside the Workers runtime with bindings. |
| `eslint` | `^10.7.0` | Lint orchestration. |
| `typescript-eslint` | `^8.63.0` | Type-aware TypeScript lint rules. |
| `prettier` | `^3.9.5` | Formatting. |
| `@playwright/test` | `^1.61.1` | Browser, embedding, and deployed smoke tests. |
| `@axe-core/playwright` | `^4.12.1` | Automated accessibility checks for the site. |
| `fast-check` | `^4.9.0` | Property tests for canonicalization, sampling, and rendering. |
| `@resvg/resvg-js` | `^2.6.2` | Rasterize SVG fixtures in Node-only visual tests. |
| `pixelmatch` | `^7.2.0` | Compare rasterized golden images. |
| `pngjs` | `^7.0.0` | Read and write PNG fixtures for visual diffs. |

The Resvg, Pixelmatch, and PNGJS packages are test-only and must never enter the Worker bundle.

Do not install `@cloudflare/workers-types` as the source of the environment interface. Generate binding types with `wrangler types` so code and `wrangler.jsonc` cannot silently drift.

## 4. Proposed repository layout

```text
.
├── docs/
│   ├── prd.md
│   └── implementation.md
├── public/
│   ├── favicon.svg
│   ├── robots.txt
│   └── social-card.png
├── site/
│   ├── components/
│   ├── layouts/
│   │   └── BaseLayout.astro
│   ├── pages/
│   │   ├── 404.astro
│   │   ├── index.astro
│   │   └── sitemap.xml.ts
│   ├── scripts/
│   │   └── request-builder.ts
│   └── styles/
│       └── global.css
├── src/
│   ├── index.ts
│   ├── app.ts
│   ├── config.ts
│   ├── domain/
│   │   ├── errors.ts
│   │   ├── market-series.ts
│   │   ├── request.ts
│   │   └── timeframe.ts
│   ├── http/
│   │   ├── headers.ts
│   │   ├── middleware.ts
│   │   └── routes/
│   │       ├── health.ts
│   │       └── sparkline.ts
│   ├── cache/
│   │   ├── data-cache.ts
│   │   ├── keys.ts
│   │   ├── policy.ts
│   │   └── response-cache.ts
│   ├── providers/
│   │   ├── provider.ts
│   │   └── lse/
│   │       ├── adapter.ts
│   │       ├── schema.ts
│   │       └── symbols.ts
│   ├── render/
│   │   ├── path.ts
│   │   ├── renderer.ts
│   │   ├── sampling.ts
│   │   └── styles.ts
│   └── telemetry/
│       ├── logger.ts
│       └── metrics.ts
├── test/
│   ├── fixtures/
│   │   ├── provider/
│   │   └── series/
│   ├── golden/
│   │   ├── png/
│   │   └── svg/
│   ├── integration/
│   ├── unit/
│   └── visual/
├── e2e/
├── astro.config.ts
├── eslint.config.js
├── package.json
├── package-lock.json
├── playwright.config.ts
├── tsconfig.json
├── vitest.config.ts
├── vitest.visual.config.ts
├── worker-configuration.d.ts
└── wrangler.jsonc
```

Keep domain, cache, provider, and renderer code independent of Hono wherever possible. The HTTP layer should coordinate them rather than contain their logic.

## 5. Required npm scripts

The initial `package.json` should expose these stable commands so humans and agents use the same workflow:

```json
{
  "scripts": {
    "dev:api": "wrangler dev",
    "dev:site": "astro dev",
    "build:site": "astro build",
    "build": "npm run build:site && wrangler deploy --env=\"\" --dry-run --outdir .wrangler/build",
    "typecheck": "tsc --noEmit && astro check",
    "lint": "eslint .",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:visual": "vitest run --config vitest.visual.config.ts",
    "test:e2e": "playwright test",
    "cf:typegen": "wrangler types",
    "check": "npm run format:check && npm run lint && npm run typecheck && npm test && npm run build",
    "deploy": "npm run build:site && wrangler deploy --env=\"\""
  }
}
```

`npm run check` is the minimum local and CI merge gate.

Local development may use the Astro server on port 4321 and Wrangler on port 8787. The request builder must read a development-only API base URL rather than hard-code production. Production uses same-origin URLs.

## 6. Cloudflare configuration

Use `wrangler.jsonc`, not TOML. Start with this shape and replace placeholders during environment setup:

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "ticker-line-api",
  "main": "src/index.ts",
  "compatibility_date": "2026-07-12",
  "compatibility_flags": ["nodejs_compat"],
  "assets": {
    "directory": "./dist",
    "run_worker_first": ["/v1/*", "/health"]
  },
  "kv_namespaces": [
    {
      "binding": "MARKET_DATA_CACHE",
      "id": "id-for-ticker-line-market-data-cache"
    }
  ],
  "ratelimits": [
    {
      "name": "SPARKLINE_BURST_RATE_LIMITER",
      "namespace_id": "7122603", // ticker-line-api-rate-limit-burst
      "simple": {
        "limit": 20,
        "period": 10
      }
    },
    {
      "name": "SPARKLINE_RATE_LIMITER",
      "namespace_id": "7122601", // ticker-line-api-rate-limit
      "simple": {
        "limit": 60,
        "period": 60
      }
    }
  ],
  "vars": {
    "APP_ENV": "production",
    "PROVIDER_ID": "lse",
    "PROVIDER_VERSION": "v1",
    "PROVIDER_BASE_URL": "replace-after-provider-validation",
    "CACHE_POLICY_VERSION": "v1",
    "NORMALIZATION_VERSION": "v2",
    "RENDERER_VERSION": "v4"
  },
  "observability": {
    "enabled": true,
    "logs": {
      "enabled": true,
      "head_sampling_rate": 1,
      "invocation_logs": true
    },
    "traces": {
      "enabled": true,
      "head_sampling_rate": 0.01
    }
  },
  "env": {
    "staging": {
      "name": "ticker-line-api-staging",
      "kv_namespaces": [
        {
          "binding": "MARKET_DATA_CACHE",
          "id": "id-for-ticker-line-market-data-cache-staging"
        }
      ],
      "ratelimits": [
        {
          "name": "SPARKLINE_BURST_RATE_LIMITER",
          "namespace_id": "7122604", // ticker-line-api-rate-limit-burst-staging
          "simple": {
            "limit": 20,
            "period": 10
          }
        },
        {
          "name": "SPARKLINE_RATE_LIMITER",
          "namespace_id": "7122602", // ticker-line-api-rate-limit-staging
          "simple": {
            "limit": 60,
            "period": 60
          }
        }
      ],
      "vars": {
        "APP_ENV": "staging",
        "PROVIDER_ID": "lse",
        "PROVIDER_VERSION": "v1",
        "PROVIDER_BASE_URL": "replace-after-provider-validation",
        "CACHE_POLICY_VERSION": "v1",
        "NORMALIZATION_VERSION": "v2",
        "RENDERER_VERSION": "v4"
      },
      "observability": {
        "enabled": true,
        "logs": {
          "enabled": true,
          "head_sampling_rate": 1,
          "invocation_logs": true
        },
        "traces": {
          "enabled": true,
          "head_sampling_rate": 0.1
        }
      }
    }
  }
}
```

Notes:

- Set the compatibility date to the scaffold date and update it deliberately with tests.
- `run_worker_first` must cover API and health routes only. Static site requests should bypass Worker code when an asset exists.
- Use separate KV namespaces and provider keys for staging and production.
- `LSE_API_KEY` is already present in the gitignored `.dev.vars` for local evaluation. Never print it, place it in a command argument, commit it, or copy it into `wrangler.jsonc`.
- Upload the key as a deployed Worker secret through Wrangler. An authorized agent may use `wrangler secret put` interactively or `wrangler deploy --secrets-file .dev.vars`; never transform it through a command that prints the value.
- `.dev.vars.example` may contain the variable name and a fake placeholder only. `.dev.vars` must remain gitignored.
- Run `npm run cf:typegen` after every binding or variable change and commit the generated declaration.
- A production deploy must use a custom domain. Cache behavior on `workers.dev` is not the launch acceptance environment.

Cache policy values should be configuration, not scattered constants. Begin with typed defaults in `src/config.ts` and allow a `CACHE_POLICY_JSON` Worker variable to override them. Validate the override once per request with a small schema; do not silently accept invalid policy. Updating deployment configuration must not require changing application source.

### Cloudflare resource naming

Every Cloudflare resource created for this project must have a dashboard-visible name beginning with `ticker-line-`. Uppercase Worker binding identifiers such as `MARKET_DATA_CACHE` are code identifiers and are exempt; the bound Cloudflare resource is not.

Use these exact names unless this document is updated:

| Resource | Production name | Staging name |
| --- | --- | --- |
| Worker and Static Assets project | `ticker-line-api` | `ticker-line-api-staging` |
| Market-data KV namespace | `ticker-line-market-data-cache` | `ticker-line-market-data-cache-staging` |
| Worker sustained rate-limit namespace label | `ticker-line-api-rate-limit` (`7122601`) | `ticker-line-api-rate-limit-staging` (`7122602`) |
| Worker burst rate-limit namespace label | `ticker-line-api-rate-limit-burst` (`7122603`) | `ticker-line-api-rate-limit-burst-staging` (`7122604`) |
| API abuse/WAF rule, if created | `ticker-line-api-abuse` | `ticker-line-api-abuse-staging` |
| Analytics Engine dataset, if later created | `ticker-line-api-metrics` | `ticker-line-api-metrics-staging` |

Before creating a resource, list existing resources and reuse an exact-name match. Do not create numbered duplicates such as `ticker-line-market-data-cache-2`. Do not alter or delete any Cloudflare resource whose name does not begin with `ticker-line-` or the explicitly retired legacy project prefix.

Workers Rate Limiting binding namespaces are identified by account-unique positive integers and are not visible as named dashboard resources. The comments and table above are their required Ticker Line labels. Keep their IDs dedicated to this project; never reuse them in another Worker.

### Provisioning and live deployment authority

Agents implementing this specification are authorized to use the logged-in Wrangler session to create and update project-scoped `ticker-line-*` resources, upload the Ticker Line Worker secret, deploy staging and production Worker versions, and test the deployed site/API. This authority does not waive the provider-rights launch gate or authorize destructive changes to unrelated Cloudflare resources.

The desktop terminal has an authenticated Wrangler session, but a bare global `wrangler` binary may not be on every agent shell's `PATH`. After dependencies exist, prefer the repository-pinned CLI through `npx wrangler`. During initial scaffolding, `npx --yes wrangler@4.110.0` is an acceptable bootstrap.

Expected setup flow:

```sh
npx wrangler whoami
npx wrangler kv namespace list
npx wrangler kv namespace create ticker-line-market-data-cache --binding MARKET_DATA_CACHE --update-config
npx wrangler kv namespace create ticker-line-market-data-cache-staging --binding MARKET_DATA_CACHE --env staging --update-config
npm run cf:typegen
npm run check
npm run build:site
npx wrangler deploy --env staging --secrets-file .dev.vars
```

Capture the returned KV IDs in the appropriate top-level and `env.staging` bindings. Keep the resource names visible in comments beside opaque IDs. Configure `env.staging.name` as `ticker-line-api-staging`; the top-level production name remains `ticker-line-api`, with `ticker-line.com` configured as its Custom Domain.

Deploy staging before production and run HTTP plus Playwright smoke tests against its live `workers.dev` URL. Once the product domain is chosen and configured, repeat cache and embedding tests on the custom domain because that is the launch environment. A deployment is not considered tested merely because Wrangler uploaded it successfully.

The live smoke suite must verify:

- `/` returns the built HTML and its static assets.
- `/health` returns success without calling LSE.
- A valid SVG request returns `image/svg+xml`, an ETag, and a unique request ID.
- Repeating the valid request exercises generated and data cache hits.
- An unknown ticker in SVG mode returns HTTP `200`, the gray fallback, and correct `X-Error-Code`/`X-Error-Status` headers.
- The same unknown ticker with `format=json` returns JSON and semantic HTTP `404`.
- `HEAD`, conditional ETag, CORS, and representative mobile/desktop Playwright tests pass against the deployed URL.

Provider-backed staging tests must remain tightly bounded. LSE permission has been confirmed by the product owner, so agents may deploy and test the live provider-backed service; production launch still requires attribution/delayed-data obligations and every remaining PRD launch gate.

## 7. Core domain types

Use integer epoch milliseconds internally for point timestamps and ISO 8601 UTC strings at HTTP/storage boundaries. Monetary values remain JavaScript finite numbers because the output is visual and no arithmetic is used for trading or accounting.

```ts
export const TIMEFRAMES = ['1d', '7d', '1m', '3m', '1y', '5y'] as const
export type Timeframe = (typeof TIMEFRAMES)[number]

export const THEMES = ['light', 'dark'] as const
export type Theme = (typeof THEMES)[number]

export const FILLS = ['false', 'true'] as const
export type FillValue = (typeof FILLS)[number]

export const FORMATS = ['svg', 'json'] as const
export type OutputFormat = (typeof FORMATS)[number]

export type CanonicalSparklineRequest = Readonly<{
  ticker: string
  timeframe: Timeframe
  theme: Theme
  fill: boolean
  format: OutputFormat
}>

export type AssetType =
  | 'stock'
  | 'crypto'
  | 'etf'
  | 'index'
  | 'forex'
  | 'unknown'

export type MarketPoint = Readonly<{
  timestamp: number
  close: number
}>

export type MarketSeries = Readonly<{
  resolvedTicker: string
  assetType: AssetType
  currency?: string
  exchange?: string
  timezone?: string
  dataAsOf: string
  referenceClose: number
  points: readonly MarketPoint[]
}>

export type MarketSeriesRequest = Readonly<{
  ticker: string
  start: Date
  end: Date
  interval: SourceInterval
}>

export interface MarketDataProvider {
  readonly id: string
  fetchSeries(
    request: MarketSeriesRequest,
    context: ProviderRequestContext,
  ): Promise<MarketSeries>
}
```

`ProviderRequestContext` should contain the request ID, abort signal, and logger fields required for one provider operation. It must not expose the full Worker environment to the adapter.

Use `Readonly` and `readonly` at domain boundaries. Construct new arrays during normalization rather than letting rendering mutate cached data.

## 8. HTTP application design

`src/index.ts` should only create and export the Hono application. Worker bindings exist on the Hono request context, so do not try to capture KV or secrets in module scope. `src/app.ts` should expose an application factory that accepts stateless factories and explicit test dependencies.

```ts
export type AppFactories = Readonly<{
  clock: Clock
  logger: Logger
  createProvider(env: Env, config: AppConfig): MarketDataProvider
  createDataCache(env: Env, config: AppConfig): DataCache
  createResponseCache(config: AppConfig): ResponseCache
}>

export function createApp(factories: AppFactories): Hono<AppBindings> {
  // Register middleware, routes, not-found handling, and error mapping.
}
```

Construct the lightweight request services from `c.env` after Hono enters the request. Tests may inject alternate factories, clocks, and providers. Do not read request-scoped state from module globals. Do not destructure `ctx.waitUntil`; call it as a method.

### Middleware order

1. Generate `requestId` with `crypto.randomUUID()`.
2. Apply method policy and CORS.
3. Apply baseline security headers.
4. Attach request-scoped structured logging context.
5. Determine the requested output mode and apply the Workers Rate Limiting binding.
6. Route the request.
7. Map domain errors to the locked JSON or SVG-fallback contract.
8. Emit one completion log/metric in a `finally`-equivalent path.

Allowed methods:

- `GET` and `HEAD` for `/v1/sparkline` and `/health`.
- `OPTIONS` for CORS on `/v1/*`.
- Other methods return `405` with `Allow` and the standard JSON-or-SVG error representation selected from the request mode.

`HEAD` must execute the same cache/validation path as `GET` but return no body and preserve the headers a corresponding `GET` would have returned, including SVG fallback error headers.

Use the `SPARKLINE_BURST_RATE_LIMITER` and `SPARKLINE_RATE_LIMITER` bindings directly; do not add rate-limit middleware packages. Apply both to the unlogged `CF-Connecting-IP` key: 20 requests per 10 seconds for bursts and 60 requests per 60 seconds for sustained traffic. Check the burst window first so a rejected burst does not consume the sustained window. A failed check throws the same typed `RateLimitedError` used by the error mapper, with `Retry-After: 10` or `Retry-After: 60` as appropriate.

These bindings are permissive, eventually consistent, and scoped per Cloudflare location. Their thresholds are abuse controls rather than exact accounting or a global provider-call budget. Tune them from production evidence, especially for shared mobile and corporate networks, and implement a separate strongly coordinated upstream governor before traffic can approach the LSE account limit.

Use WAF/rate-limit blocking only as a coarse emergency abuse layer above the application threshold. A pre-Worker Cloudflare block cannot satisfy the normal SVG fallback contract and should not be the routine fair-use response path.

### Public query validation

Validate the raw query as a record before applying defaults:

- Reject duplicate query keys, including identical duplicates.
- Reject every unknown key.
- Require exactly one `ticker`.
- Trim ticker, then validate length and allowed characters before uppercasing.
- Permit only an explicit conservative ticker character set: ASCII letters, digits, `.`, `/`, `-`, `^`, `=`, and `_`. Slash is required by verified LSE symbols such as `XAU/USD` and `USD/CAD` and is accepted only inside the query value.
- Reject control characters, percent-decoded separators, empty values, and overlong URLs.
- Treat documented enum values as lowercase. Accept only literal `false` or `true` for `fill`; keep `timeframe`, `theme`, `fill`, and `format` lowercase-only.
- Apply defaults only after the submitted values are valid.

The returned `CanonicalSparklineRequest` is the only request shape allowed below the HTTP layer.

### Canonical representation

Use a stable internal serialization rather than the incoming URL:

```text
ticker=AAPL&timeframe=1m&theme=light&fill=false&format=svg
```

Fields always appear in that order and always include defaults. Do not use `JSON.stringify` on an object as a cache key contract.

### Response headers

Every API response should include, where applicable:

- `X-Request-Id`: unique to this HTTP request; never cache this value.
- `X-Data-As-Of`: timestamp from the normalized series.
- `X-Cache`: `HIT`, `MISS`, or `STALE` for the generated response presented to the caller.
- `X-Error-Code`: public error code on an SVG fallback response only.
- `X-Error-Status`: semantic JSON-mode status on an SVG fallback response only.
- `ETag`: strong validator computed from the exact response body bytes.
- `Cache-Control`: browser/shared-cache policy selected from the freshness policy.
- `Access-Control-Allow-Origin: *`.
- `X-Content-Type-Options: nosniff`.
- Conservative `Referrer-Policy` and SVG CSP headers from the PRD.

Do not cache an `X-Request-Id` inside a stored response. Add it when a cached artifact is converted into the outgoing response.

Handle `If-None-Match` after selecting the current representation. A match returns `304`, no body, and current request/cache metadata.

## 9. End-to-end request flow

For `GET /v1/sparkline`:

1. Validate and canonicalize the query.
2. Derive a versioned generated-response cache key.
3. Look in `caches.default` for the complete body and stable representation metadata.
4. On a generated-response hit, decorate it with this request's ID and cache status, then apply conditional response handling.
5. On a miss, ask the normalized data cache for the canonical ticker/timeframe/interval series.
6. If data is fresh, use it immediately.
7. If data is stale but still serviceable, use it immediately and schedule a refresh with `ctx.waitUntil()`.
8. If data is absent or beyond `staleUntil`, fetch the provider synchronously within the request budget.
9. Normalize, select the visible points and reference close, validate, and store successful provider data in KV.
10. Deterministically sample and render the selected output format.
11. Compute the ETag from the exact output bytes.
12. Store the stable generated representation with an expiry no later than the underlying data's `freshUntil`.
13. Add per-request headers and return.

If a stale background refresh fails, keep serving the existing value until `staleUntil`, log the failure, and apply a short retry backoff so every request does not immediately retry.

At any failure point, map the error to one public code and semantic status. If the request is in valid SVG mode, render or retrieve the corresponding fallback SVG and return HTTP `200` with `X-Error-Code` and `X-Error-Status`. If the request is in JSON mode, return the normal JSON body with its semantic HTTP status. An omitted `format` is SVG mode; an invalid or duplicate `format` is not valid SVG mode and returns JSON `400`.

## 10. Caching implementation

Caching has two application-controlled layers. Browser or intermediary caching is useful but cannot be the only provider-call protection.

### 10.1 Generated response cache

Use `caches.default` for generated SVG and JSON representations.

Key format:

```text
https://cache.internal/render/{rendererVersion}/{normalizationVersion}?
  ticker=AAPL&timeframe=1m&theme=light&fill=false&format=svg
```

Construct the internal URL programmatically without line breaks. It must contain no secret or provider credential. SVG and JSON are separate keys. Renderer and normalization version changes roll forward without a purge.

Store:

- Exact response body.
- `Content-Type`.
- `ETag`.
- `X-Data-As-Of`.
- An internal stable header encoding the source `freshUntil` if needed.
- An internal representation-state header so a cached short-lived stale artifact remains observable as `STALE`.
- A `Cache-Control` max age equal to the remaining fresh lifetime.

Do not store:

- `X-Request-Id`.
- A request-specific `X-Cache` value.
- Provider identity or raw errors.

The Workers Cache API is data-center-local and does not implement `stale-while-revalidate` or `stale-if-error` for `cache.put`/`cache.match`. Do not write tests or production logic that assumes otherwise. Normal generated entries are fresh-only; stale resilience comes from the KV data record. A response rendered from stale data may be cached only for the short retry-backoff duration, must remain labeled stale, and must never be given a new data-freshness timestamp.

Use `ctx.waitUntil(responseCache.put(...))` only when the response can safely be returned before the write finishes. Await any write required for subsequent correctness. Cache write failures should be logged but should not fail an otherwise valid chart response.

### 10.2 Normalized data cache

Use a stable requested-symbol key for MVP:

```text
market-data:{cachePolicyVersion}:{providerId}:{providerVersion}:{normalizationVersion}:{ticker}:{timeframe}:{interval}
```

Do not include exact rolling start/end timestamps; doing so creates a new cache entry on every request. The value records the actual covered range. Aliases may initially occupy duplicate entries; add an alias map only after measuring meaningful duplication.

For `1d`, widen the single provider request to eight calendar days so the same response normally contains the latest session plus a comparison candle across weekends and holidays. For session-based data, find the last gap longer than two hours, use the candle immediately before it as `referenceClose`, and retain the points after it for rendering. For continuous crypto/forex data, retain the trailing 24-hour points and use the first retained close. Never issue a second provider request solely to compute quote metadata.

KV record shape:

```ts
export type CachedMarketSeries = Readonly<{
  schemaVersion: 2
  fetchedAt: string
  freshUntil: string
  staleUntil: string
  retryAfter?: string
  requestRange: Readonly<{
    start: string
    end: string
    interval: SourceInterval
  }>
  series: MarketSeries
}>
```

Validate cached values with Zod. Treat malformed or unknown-version values as misses, log a sanitized warning, and overwrite them after a successful fetch.

Set KV physical expiration after `staleUntil` with a small cleanup margin. Logical freshness always comes from timestamps in the value, not from presence in KV.

KV is eventually consistent. The design accepts that separate locations may briefly perform duplicate provider refreshes or observe the preceding series. Do not attempt to implement a distributed lock in KV. Add a Durable Object coordinator only if production metrics show unacceptable provider amplification or concurrent-write problems.

Do not use a module-global promise map as a correctness mechanism. A future best-effort local coalescer may be considered separately, but correctness and provider protection must not depend on isolate reuse.

### 10.3 Negative caching

Store negative records separately from successful series:

```ts
export type NegativeCacheRecord = Readonly<{
  schemaVersion: 1
  kind: 'not_found' | 'insufficient_data'
  cachedAt: string
  expiresAt: string
}>
```

Suggested starting TTLs:

- Definitive ticker not found: 5 minutes.
- Insufficient data for a valid symbol/range: 10 minutes.
- Provider authentication, timeout, rate limit, and 5xx failures: never negative-cache as ticker absence.

Generated JSON error responses need no application cache. Shared caches must not store JSON `429`, `502`, or `503` responses. SVG fallback artifacts follow the explicit short policy in section 10.5.

### 10.4 Freshness policy

Implement one pure policy function. Do not spread TTL values through routes and adapters.

```ts
export interface FreshnessPolicy {
  evaluate(input: FreshnessInput): FreshnessDecision
}

export type FreshnessDecision = Readonly<{
  freshForSeconds: number
  staleForSeconds: number
  browserMaxAgeSeconds: number
  retryBackoffSeconds: number
  reason: string
}>
```

Starting active-market values:

| Timeframe | Preferred source interval | Fresh | Serve stale after provider failure |
| --- | --- | --- | --- |
| `1d` | 5–15 minutes | 25 minutes | 1 hour |
| `7d` | 30–60 minutes | 100 minutes | 6 hours |
| `1m` | Daily | 5 hours | 24 hours |
| `3m` | Daily | 10 hours | 24 hours |
| `1y` | Daily | 20 hours | 3 days |
| `5y` | Weekly/downsampled daily | 5 days | 7 days |

Crypto uses active-market values continuously. For exchange-listed assets, an adapter may provide trusted market-state or next-session metadata. If it does, expire shortly after the next expected meaningful update while the market is closed. If reliable calendar information is unavailable, use conservative fixed TTLs; do not guess holidays and present the result as authoritative.

The final candle is provisional when the provider supplies an incomplete candle. Preserve it for freshness and document the behavior. If the provider returns closed candles only, align `freshUntil` to the next expected candle publication rather than polling repeatedly inside the candle.

Browser `max-age` should normally be 60 seconds. Shared or application cache lifetime may be longer. Example public header for a 100-minute active data lifetime:

```http
Cache-Control: public, max-age=60, s-maxage=6000, stale-while-revalidate=3600, stale-if-error=86400
```

These directives benefit browsers and compatible intermediaries. They do not change the documented behavior of `caches.default`.

### 10.5 SVG fallback cache policy

Fallback SVGs are deterministic by public error code and fallback-renderer version. Do not key them by ticker, message, request ID, theme, or fill.

Suggested cache behavior:

| Error code | Generated fallback freshness | Data/negative cache behavior |
| --- | --- | --- |
| `INVALID_REQUEST` | Up to 5 minutes by error code | No provider or negative-data entry. |
| `TICKER_NOT_FOUND` | Match the negative lookup TTL, initially 5 minutes | Store the negative symbol lookup. |
| `INSUFFICIENT_DATA` | Match the negative lookup TTL, initially 10 minutes | Store the insufficient-data lookup. |
| `RATE_LIMITED` | At most `Retry-After`; otherwise do not cache in shared caches | Do not treat as symbol absence. |
| `PROVIDER_ERROR` | 30–60 seconds | Preserve acceptable stale market data separately. |
| `SERVICE_UNAVAILABLE` | 30–60 seconds | No negative symbol entry. |

The stored fallback artifact must omit `X-Request-Id`; add a fresh request ID when serving it. Preserve internal error-code and semantic-status metadata so a Cache API hit remains observable as a failure rather than a successful chart.

## 11. Provider adapter

LSE is the technically preferred MVP adapter based on the 2026-07-12 evaluation below. The product owner confirmed on 2026-07-12 that LSE granted permission for automated API use, caching/storage, public derived SVG display, redistribution, and commercial use. Retain that confirmation outside the public repository and implement any attribution or delayed-data conditions from the agreement before launch.

The adapter owns:

- Authentication and URL construction.
- Mapping timeframe to provider interval.
- Provider symbol syntax.
- Timeout and retry behavior.
- Response byte limits.
- Provider-specific Zod validation.
- Timestamp, close, currency, exchange, timezone, and asset-type normalization.
- Mapping provider errors into internal typed errors.

The adapter must not:

- Return provider-native objects to domain or rendering code.
- Log credentials, complete upstream URLs containing credentials, or raw response bodies.
- Reflect provider error text to clients.
- Retry permanent 4xx errors.
- Silently return partial pages when pagination is required.

### Verified LSE HTTP contract

The live evaluation used the configured `LSE_API_KEY` without printing or persisting it outside `.dev.vars`.

| Concern | Verified behavior through 2026-07-13 |
| --- | --- |
| Base URL | `https://api.londonstrategicedge.com/vault` |
| Authentication | `x-api-key` request header |
| Candle endpoint | `GET /candles` |
| Required symbol syntax | Exact catalog spelling; `AAPL` works, crypto is `BTC/USD`, and `BTC-USD` returns `404` |
| Timeframes | `1s`, `5s`, `15s`, `30s`, `1m`, `3m`, `5m`, `15m`, `30m`, `1h`, `4h`, `1d`, `1w`, `1mo` |
| Query controls | `symbol`, `timeframe`, `start`, `end`, `order`, `limit`, and optional `dataset` |
| Successful rows | JSON array with `ts`, `symbol`, `open`, `high`, `low`, `close`, and usually `volume` |
| Unknown symbol | HTTP `404`; provider detail is nested/stringified and must not be exposed |
| Evaluated allowance | 200 calls/minute, 5,000 rows/request, and 50 GB/month for the configured key |
| Adjustment | Provider docs state stock and ETF candles are split adjusted |

Observed representative payloads:

- AAPL daily, one calendar year: 250 rows and roughly 31 KB.
- AAPL weekly, five calendar years: 261 rows and roughly 33 KB.
- AAPL 15-minute across two recent trading days: 128 rows and roughly 16 KB, including extended-hours timestamps.
- BTC/USD hourly returned current continuous-market rows with the same OHLCV shape.
- The full `/catalog` response was about 8.5 MB and 22,678 entries.
- `VOD.L` and `VOD` both succeeded as distinct instruments.
- `NAS100/USD`, `XAU/USD`, and `USD/CAD` returned populated daily candles and resolved to those exact provider symbols.
- The newest one-minute crypto candle was provisional and advanced on the next minute boundary.
- Candle rows exposed no currency, exchange, timezone, or asset-type metadata.

Conclusions for the adapter:

- Map friendly public aliases such as `BTC-USD` and `NAS100-USD` to LSE's slash symbols before fetching. Preserve verified exact provider symbols such as `XAU/USD` and `USD/CAD`. Keep every mapping provider-specific and explicitly tested.
- Use `15m`, `1h`, `1d`, and `1w` for the initial public timeframe mapping. The provider has ample resolution coverage for the PRD target sizes.
- Retain LSE's supplied extended-hours equity candles instead of adding exchange-session filtering in MVP.
- For a `1d` equity request during a weekend or holiday, fetch and display the most recent available trading session rather than failing on an empty current-calendar-day range.
- Use LSE's split-adjusted stock and ETF close directly. Do not add a second split/dividend adjustment pipeline in MVP.
- Never fetch `/catalog` on a sparkline request. If catalog-backed discovery is later needed, refresh it out of band into a bounded artifact.
- Do not rely on `/catalog` query filtering: tested `symbol`, `search`, `dataset`, and `limit` parameters did not bound the response.
- Keep the 2 MB candle response cap; evaluated sparkline payloads are far below it. Give discovery endpoints a separate explicit policy rather than relaxing the candle cap.
- Parse validated LSE timezone-less candle timestamps explicitly as UTC, matching the provider's official loading guide. Never pass the raw value to environment-dependent `new Date(string)` parsing.
- Retain provider-supplied extended-hours data for `1d` equity charts; do not add exchange-session filtering in MVP.
- Because a calendar `1d` window may contain no equity rows on weekends or holidays, the series service needs a tested last-session fallback rather than immediately returning `INSUFFICIENT_DATA`.
- Preserve exact suffixes: `VOD.L` and `VOD` are different valid instruments. Never strip or guess an exchange suffix.
- Omit `dataset` initially unless symbol classification is deterministic. A wrong discriminator returns `200 []` instead of a useful provider error.
- Preserve the final provider candle and mark it provisional in documentation and freshness reasoning.
- Keep `currency`, `exchange`, and `timezone` optional; do not synthesize them. The public JSON response omits `currency` when unknown.
- Do not use `/usage`, `/meta`, or `/catalog` in the hot path. They are suitable for operational checks and opt-in smoke tests.

Provider smoke tests must have a strict call budget and should cover `AAPL`, `BTC/USD`, the public `BTC-USD` alias, one long-history query, and one known-invalid symbol. Log only status, row count, response size, and timestamp bounds.

### Provider request budget

Start with:

- 1.5 second total upstream budget.
- At most one retry for a network error or selected 5xx response when enough budget remains.
- No immediate retry for authentication failures, invalid symbols, or `429`.
- Respect `Retry-After` internally when useful, but prefer stale data over blocking a public request.
- Maximum provider response body: 2 MB.
- Maximum raw points accepted: 5,000, matching the verified provider page cap.
- Maximum normalized points sent to rendering: 250.

Read the provider body through a bounded stream helper before `JSON.parse`; checking only `Content-Length` is insufficient because it may be missing or incorrect.

### Normalization rules

In order:

1. Validate the provider envelope and required fields.
2. Convert timestamps to epoch milliseconds.
3. Convert close values to finite numbers.
4. Remove points with invalid timestamps, non-finite closes, or disallowed zero values once semantics are confirmed.
5. Sort ascending by timestamp.
6. Deduplicate identical timestamps deterministically, preferring the final provider occurrence.
7. Apply raw-versus-adjusted-close policy decided during provider feasibility.
8. Determine `dataAsOf` from the most recent accepted provider timestamp, not fetch completion time.
9. Verify at least one distinct valid point remains; the renderer must handle a single point safely.
10. Freeze or treat the returned structure as immutable.

The adapter should throw typed internal errors such as `ProviderNotFoundError`, `ProviderRateLimitError`, `ProviderTimeoutError`, `ProviderSchemaError`, and `InsufficientDataError`. The HTTP layer maps these to the PRD error codes.

Classify LSE responses by HTTP status before inspecting the optional untrusted body:

- `200` with valid rows: normalize and return.
- `200 []`: `INSUFFICIENT_DATA` unless independent cached evidence proves the symbol does not exist.
- `401` or `403`: permanent provider authentication/authorization failure; do not retry.
- `404`: `TICKER_NOT_FOUND`; never expose the nested provider detail.
- `422`: provider request/schema failure; do not retry.
- `429`: transient rate limit; honor `Retry-After`, do not retry immediately, and prefer stale data.
- `5xx`, network failure, or timeout: transient provider error with at most one bounded retry when budget remains.

Use a 10-second total provider deadline for the evaluated LSE candle endpoint. The deadline is shared across both attempts rather than applied independently, so one retry cannot double the request budget. Revisit this value from observed provider latency; the July 2026 live evaluation showed successful candle responses commonly taking 3–6 seconds.

Provider `detail` bodies may be direct strings or nested/stringified JSON. Do not recursively parse them for normal control flow.

## 12. Sampling and rendering

The SVG renderer is a pure function. Do not use a DOM, canvas, chart library, JSX renderer, or provider markup.

```ts
export type RenderOptions = Readonly<{
  width: 160
  height: 48
  theme: Theme
  fill: boolean
  ticker: string
  timeframe: Timeframe
}>

export function renderSparkline(
  points: readonly MarketPoint[],
  options: RenderOptions,
): string

export function renderErrorSparkline(code: PublicErrorCode): string
```

### Sampling

- Target 30–250 points and never render more than 250.
- If the source is already within bounds, preserve all accepted points.
- Implement deterministic min/max bucket sampling first because it is small and preserves spikes.
- Always preserve first, last, global minimum, and global maximum points.
- Preserve chronological order and never synthesize prices.
- Keep the sampling function separate so largest-triangle-three-buckets can be evaluated later without changing the provider adapter.

### Geometry

- Fixed intrinsic width 160 and height 48.
- Fixed visual padding, declared as renderer constants.
- Map timestamps to x coordinates, not array indexes, so gaps remain visible. If visual tests show excessive compression from market closures, revisit this explicitly rather than silently switching semantics.
- Map price extrema to the drawable y range.
- Use the first accepted close as a horizontal reference baseline across the drawable width.
- Split line segments exactly where they cross the baseline. Render portions above it in the controlled positive green and portions below it in the controlled negative red.
- When `fill=true`, fill each positive or negative region between the price line and the baseline with the matching controlled color and fixed opacity. Do not fill to the bottom of the SVG.
- Expand a flat series by a deterministic synthetic y extent so it renders as a centered horizontal line.
- Render a single point as a short centered horizontal path segment so it remains visible without adding a new SVG element type.
- Round output coordinates to a fixed precision, initially two decimal places.
- Normalize negative zero to `0`.
- Use one stable path-command format and attribute order.

### Error fallback SVG

`renderErrorSparkline` returns a fixed `160 × 48` transparent SVG containing:

- A fixed neutral-gray decorative sparkline path.
- The public error code centered as visible monospace text at a size tested for the longest code.
- A `<title>` containing `Sparkline unavailable: {CODE}`.
- A generic `<desc>` containing no ticker, provider message, or request ID.

It ignores requested theme and fill. Its only cache dimensions are fallback-renderer version and public error code. It must never call the market-data renderer with invented price points.

### Safe SVG output

The successful-chart output allowlist is `<svg>`, `<path>`, `<title>`, and `<desc>`. The fallback renderer additionally allows one controlled `<text>` element. Escape ticker and descriptive text with a dedicated XML text escaper. Never interpolate unvalidated attribute names or raw strings.

Use controlled attributes only:

- `xmlns`, `viewBox`, `width`, `height`, and accessibility attributes on `<svg>`.
- `d`, `fill`, `fill-opacity`, `stroke`, `stroke-width`, `stroke-dasharray`, `stroke-linecap`, and `stroke-linejoin` on `<path>`.
- `x`, `y`, `fill`, `font-family`, `font-size`, and `text-anchor` on the fallback `<text>`.

The same normalized series, render options, and renderer version must yield byte-identical SVG.

### JSON output

Render SVG first, then serialize the locked flat JSON envelope. Use ordinary `JSON.stringify` on an object constructed in explicit field order. Do not include cache internals, provider identity, or points.

## 13. Error model

Define domain errors with stable internal categories and one mapper to public errors. Routes should not construct ad hoc error bodies.

```ts
export type PublicErrorCode =
  | 'INVALID_REQUEST'
  | 'TICKER_NOT_FOUND'
  | 'INSUFFICIENT_DATA'
  | 'RATE_LIMITED'
  | 'PROVIDER_ERROR'
  | 'SERVICE_UNAVAILABLE'
```

JSON-mode public errors contain only the locked `error` object and request ID and retain their semantic HTTP status. SVG-mode errors return the deterministic fallback SVG with HTTP `200`, `X-Error-Code`, and `X-Error-Status`. Attach `Retry-After` to either representation where meaningful.

The error mapper must first determine the public code and semantic status, then choose a representation. Do not implement separate error-classification logic in the JSON and fallback paths. The fallback uses only the public code; detailed public messages remain JSON-only.

Unexpected exceptions map to `SERVICE_UNAVAILABLE`, receive an internal error log with the request ID, and never expose stack traces or exception messages.

## 14. Observability

Use structured object logs written through a tiny internal logger interface so Workers Logs indexes each field. Do not serialize the object to a JSON string before passing it to `console`, and do not introduce Pino or another logger unless Cloudflare log integration demonstrates a need. Emit operational failures through `console.error`, expected client failures through `console.warn`, and successful completion events through `console.log`.

One request-completion event should include:

- Event name and schema version.
- Request ID.
- Route and method.
- HTTP status.
- Semantic status and public error code for a fallback SVG, because its transport status is intentionally `200`.
- Outcome classification of `chart`, `fallback`, or `json_error` so fallback volume does not inflate success metrics.
- Duration.
- Canonical timeframe and format when validation succeeded.
- Coarse asset type when known.
- Generated-cache state.
- Data-cache state.
- Provider outcome and latency when called.
- Render duration and point count when rendered.
- Stale age when stale data is served.

Never log:

- Provider credentials or secret-bearing URLs.
- Raw provider responses.
- Full IP addresses.
- Full user-agent strings.
- SVG or JSON response bodies.

Sample successful completion logs according to environment configuration; retain errors. Emit unsampled aggregate metrics where the selected Cloudflare facility permits it. Start with Workers Logs and built-in analytics; add Analytics Engine only when product metrics require dimensions unavailable from those sources.

## 15. Testing strategy

Tests are organized by what they prove, not solely by source folder.

### 15.1 Pure unit tests

Run deterministic domain tests quickly:

- Query validation and canonical serialization.
- Cache key stability and separation across meaningful variants.
- Timeframe-to-range and timeframe-to-interval mapping.
- Freshness policy for active, closed, continuous, and unknown market states.
- Provider normalization.
- Sampling invariants.
- SVG geometry and XML escaping.
- Error mapping.

Inject a `Clock` rather than mocking global `Date` throughout the codebase.

Use `fast-check` properties for:

- Canonicalization idempotence.
- Equivalent valid requests producing identical cache keys.
- Distinct format/theme/fill values not colliding.
- Sampling output remaining sorted, bounded, finite, and drawn from input.
- Renderer output never containing `NaN`, `Infinity`, `-0`, scripts, event attributes, or unescaped supplied ticker text.
- Arbitrary finite series rendering without throwing.

### 15.2 Provider contract tests

Keep sanitized provider fixtures for success and each known failure shape. Test:

- Every supported asset class and representative symbol syntax.
- Empty, malformed, truncated, and unexpectedly typed payloads.
- Duplicate and out-of-order candles.
- Missing currency/exchange/timezone.
- Provider error and rate-limit envelopes.
- Pagination if required.
- Body-size and point-count caps.

No default test may call the live provider. A separately named, opt-in smoke test may use a secret in CI or a developer environment and must have a strict call budget.

### 15.3 Worker integration tests

Use `@cloudflare/vitest-pool-workers` with isolated KV storage and the Workers runtime. Use Cloudflare's fetch mocking APIs and disable unmocked network access.

Cover:

- Raw SVG and JSON success contracts.
- `GET`, `HEAD`, and `OPTIONS`.
- Every validation error and unsupported method.
- SVG fallback bodies, `X-Error-Code`, `X-Error-Status`, and transport `200` for every public error code.
- JSON-mode preservation of semantic `400`/`404`/`405`/`422`/`429`/`502`/`503` statuses.
- Omitted `format` selecting SVG fallback and invalid/duplicate `format` selecting JSON `400`.
- Exact response content types and required headers.
- Fresh generated-response hit.
- Fresh data-cache hit after response-cache miss.
- Stale-while-refresh behavior.
- Provider failure with acceptable stale data.
- Provider failure after stale expiry.
- Negative-cache hit and expiry.
- Cache version roll-forward.
- Conditional `If-None-Match` response.
- No cached request ID reuse.
- No cached fallback request ID reuse and no fallback counted as a successful chart in telemetry.
- Concurrent identical misses, recording the observed KV limitations without asserting global single-flight behavior.

### 15.4 Golden and visual tests

Maintain SVG snapshots for:

- Rising, falling, flat, single-point, sparse, gapped, volatile, negative-value, large-value, and mixed-invalid series.
- Every theme and fill mode, including a series that crosses the baseline repeatedly and therefore uses both directional colors.
- XML-sensitive ticker text at the renderer boundary.
- Every fallback error code, including legibility of the longest code at `160 × 48`.

Rasterize golden SVGs with Resvg in a Node Vitest project and compare PNG output with Pixelmatch. Keep a small explicit tolerance for rasterizer differences. A changed golden requires human inspection and an intentional renderer-version decision.

### 15.5 Browser and end-to-end tests

Use Playwright against a deployed preview or local full build. Verify:

- Direct SVG navigation in Chromium, Firefox, and WebKit.
- SVG loaded through `<img>`.
- Markdown-equivalent image behavior where practical.
- Light and dark website layouts at mobile and desktop sizes.
- Interactive request builder URL generation and copy controls.
- JSON example execution.
- Site navigation, canonical metadata, Open Graph tags, structured data, `robots.txt`, and sitemap.
- Axe accessibility checks and keyboard navigation.
- A provider error with `format=json` remains visible as JSON with its semantic status.
- A provider error loaded through `<img>` renders the gray fallback rather than a browser broken-image indicator.

### 15.6 Security tests

Include regression cases for:

- Query duplication and cache-key confusion.
- Oversized ticker and URL input.
- Encoded control characters and separators.
- SVG/XML injection payloads.
- Unknown parameters.
- CORS preflight behavior.
- Method confusion.
- Provider oversized bodies and decompression surprises where testable.
- No secret or raw provider error in logs/responses.

### 15.7 Load and outage tests

Before launch, run a non-production load test covering:

- Hot popular symbols.
- High-cardinality random invalid symbols.
- Simultaneous cold requests for one key.
- Mixed timeframe/theme/format traffic.
- Provider delay, timeout, 429, and 5xx injection.

Measure provider-call avoidance, Worker p95, KV reads/writes, cache hit rates, and error rates. Do not point an uncontrolled load test at the real provider.

## 16. Website implementation

Use Astro static output. The page should ship useful HTML without JavaScript. JavaScript progressively enhances only the request builder, copy buttons, and live preview.

Implementation rules:

- Put primary content in `.astro` templates, not client-rendered components.
- Use semantic HTML and one global stylesheet with CSS custom properties.
- Use system fonts or self-hosted font assets only after measuring their cost.
- Do not add a utility CSS framework for one page.
- Generate examples from shared parameter constants where build tooling permits; otherwise add a contract test that checks site examples against API enums.
- Make the preview image URL same-origin in production.
- Debounce preview changes and do not request on every keystroke before ticker validation succeeds.
- Preserve a useful `alt` value generated from ticker and timeframe.
- Keep analytics privacy-preserving and isolated from API telemetry.
- Document that SVG embeds receive a visible fallback with HTTP `200`, while `format=json` is required for semantic HTTP error statuses.

Astro outputs to `dist`, which Workers Static Assets serves directly. Static asset requests should not invoke Worker code.

## 17. CI/CD and environments

Use three environments:

- Local: fake or explicitly enabled provider access, local/preview KV.
- Preview/staging: custom non-production hostname, separate provider key and KV, production-like cache configuration.
- Production: production hostname, bindings, secrets, rate limits, and monitoring.

Pull-request CI should run:

1. `npm ci`
2. `npm run cf:typegen` followed by a clean-diff check
3. `npm run format:check`
4. `npm run lint`
5. `npm run typecheck`
6. `npm test`
7. `npm run test:visual`
8. `npm run build`

Run Playwright against a preview deployment when deployment credentials and workflow are established. Production deployment should require all launch gates and a post-deploy smoke test.

Do not run `wrangler secret bulk` from a tracked file. Configure CI secrets in the deployment environment and scope tokens to the minimum required Cloudflare account and resources.

## 18. Agent implementation sequence

Agents should build vertical slices in this order. Each slice leaves the repository passing `npm run check`.

### Slice 1: scaffold and health

- Create package/config files and directory structure.
- Configure Worker, static assets, type generation, linting, formatting, and tests.
- Implement `/health` without a provider call.
- Add a minimal static Astro page.

Acceptance: local Worker and site start, generated bindings typecheck, health and static-asset tests pass.

### Slice 2: request contract

- Implement query schema, duplicate/unknown detection, defaults, canonicalization, method/CORS policy, request IDs, public error classification, and JSON-versus-SVG error representation selection.
- Stub the market-series service behind an interface.

Acceptance: all valid and invalid public request contract tests pass without provider or cache implementation.

### Slice 3: renderer

- Implement normalization-independent sampling, path geometry, style resolution, XML escaping, successful SVG output, gray error-fallback SVG output, JSON envelope, and ETag calculation.
- Add fixtures, property tests, golden SVGs, and initial visual diffs.

Acceptance: deterministic output and all required renderer fixtures pass.

### Slice 4: provider adapter

- Read `docs/lse-provider-spike.md`, then implement bounded fetch, provider schema, typed errors, normalization, and opt-in live smoke tests.
- Confirm actual provider interval and timestamp semantics before finalizing mappings.

Acceptance: fixture-backed contract suite passes; legal/rights Phase 0 remains a separate launch gate.

### Slice 5: normalized data cache

- Implement KV schemas, keys, logical freshness, negative records, stale-on-error, background refresh, and retry backoff.
- Add an injectable clock and comprehensive cache-state tests.

Acceptance: fresh, stale, expired, corrupted, negative, and provider-failure transitions pass in the Workers runtime.

### Slice 6: generated response cache

- Implement versioned Cache API keys and response storage.
- Ensure chart and fallback cache entries omit request-specific metadata.
- Add conditional requests and public cache headers.

Acceptance: cache hits are byte-stable, request IDs remain unique, and entries never outlive underlying freshness.

### Slice 7: complete website

- Implement all PRD sections, examples, request builder, metadata, sitemap, legal placeholders, responsive styles, and accessibility behavior.

Acceptance: static-without-JS content is complete; Playwright and Axe checks pass.

### Slice 8: production hardening

- Provision the named `ticker-line-*` resources, then configure rate limiting, deployed secrets, observability, alerts, staging domain, and load/outage tests.
- Verify provider rights, attribution, incomplete-candle behavior, and caching on the deployed custom domain.

Acceptance: every PRD launch gate has evidence or is explicitly marked blocked.

## 19. Definition of done

Implementation is ready for public launch only when:

- `npm run check`, visual tests, and deployed Playwright tests pass.
- The public API exactly matches the locked PRD.
- Provider storage, caching, derived-display, commercial-use, and attribution rights are confirmed in writing.
- Provider rate limits and interval semantics are recorded.
- Adjusted/raw close and incomplete-candle rules are implemented and documented.
- Cache state transitions have tests using real Worker bindings locally.
- Cache behavior is verified on the production-style custom domain.
- The service can return acceptable stale data during an injected provider outage.
- Every SVG-mode failure renders a deterministic gray fallback, and fallback responses remain distinguishable in headers and telemetry.
- No cached response reuses a request ID.
- No secrets or raw provider errors appear in responses or sampled logs.
- Rate limiting and abuse controls are enabled and tested.
- Dashboards and alerts cover provider failures, cache-hit collapse, elevated errors, and unusual cost/traffic.
- Rollback and provider-disable procedures have been exercised.

## 20. Deferred decisions and explicit extension points

These are intentionally not solved in the first build:

- Durable Object refresh coordination: add behind `DataCache` only after measuring stampedes.
- Second provider: add behind `MarketDataProvider`; do not silently fail over without compatibility rules.
- Historical prefix/tail caching: add inside the data service if long-history payload cost is material.
- Accurate multi-exchange calendars: add behind a `MarketClock` interface once supported exchanges and a reliable source are known.
- PNG rendering: add as a separate output renderer and cache dimension only after product approval.
- API authentication: add at HTTP middleware boundaries without putting secrets in image URLs.
- Analytics Engine: add behind the metrics interface if built-in telemetry is insufficient.

## 21. Primary technical references

- [Cloudflare Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/)
- [Workers Static Assets configuration and bindings](https://developers.cloudflare.com/workers/static-assets/binding/)
- [Workers Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/)
- [Workers Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
- [How Workers KV works](https://developers.cloudflare.com/kv/concepts/how-kv-works/)
- [Workers Vitest integration](https://developers.cloudflare.com/workers/testing/vitest-integration/)
- [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [Hono on Cloudflare Workers](https://hono.dev/docs/getting-started/cloudflare-workers)
- [Hono validation](https://hono.dev/docs/guides/validation)
- [Astro Cloudflare deployment](https://docs.astro.build/en/guides/deploy/cloudflare/)
- [London Strategic Edge API documentation](https://londonstrategicedge.com/api-documentation/)
- [London Strategic Edge API overview](https://londonstrategicedge.com/free-market-data-api/)
- [London Strategic Edge Terms of Service](https://londonstrategicedge.com/terms-of-service)
- [Local LSE provider spike](./lse-provider-spike.md)

Before copying API signatures or Wrangler fields during implementation, check the current official documentation and installed config schema. Cloudflare runtime APIs and package requirements evolve faster than this document.
