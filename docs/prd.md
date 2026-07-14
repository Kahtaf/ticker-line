# ticker-line — Product overview and requirements

This document is the evergreen product definition for ticker-line. It describes the supported public experience and the behavior that must remain stable. A change to the public contract, market-data semantics, caching behavior, or service limits must update this document in the same change.

## Product summary

ticker-line is a hosted HTTP API that turns a market symbol and timeframe into a compact SVG price chart. The common integration is one image URL:

```html
<img
  src="https://ticker-line.com/v1/sparkline?ticker=AAPL&timeframe=1m"
  alt="AAPL price over one month"
  width="160"
  height="48"
/>
```

The API is public and does not require a client API key. It runs on Cloudflare Workers, caches normalized market data and rendered responses, and serves the product documentation from the same domain.

ticker-line visualizes third-party market data. It is not a trading service, execution venue, financial adviser, or guaranteed real-time quote feed.

## Users and jobs

The primary users are developers, publishers, designers, and prototypers who need a small market chart without operating a market-data pipeline or chart renderer.

Core jobs:

- Embed a current-looking chart in HTML, Markdown, dashboards, newsletters, and documentation.
- Render the same chart for light or dark interfaces.
- Optionally fill gains and losses relative to the chart reference price.
- Retrieve quote metadata and the SVG together as JSON.
- Continue displaying a recent chart during a bounded provider outage.

## Product principles

1. **The URL is the interface.** The primary use case works in an image tag without JavaScript or an SDK.
2. **Stable and cacheable by default.** Equivalent requests share canonical keys and deterministic output.
3. **A small public surface.** New parameters are added only when their value justifies validation, documentation, testing, and cache cardinality.
4. **Provider-neutral behavior.** Provider syntax and failures are normalized behind the public contract.
5. **Safe SVG only.** The service generates controlled markup and never passes through upstream or user-provided SVG.
6. **Bounded stale data is better than a broken embed.** Freshness remains observable through headers and JSON metadata.

## Public API

### Sparkline endpoint

```http
GET /v1/sparkline?ticker=AAPL&timeframe=1m
```

`GET` and `HEAD` are supported. `OPTIONS` returns a CORS preflight response. Other methods return `405` behavior through the normal JSON or SVG error contract.

### Query parameters

| Parameter | Required | Default | Supported values |
| --- | --- | --- | --- |
| `ticker` | Yes | — | A London Strategic Edge-supported symbol, up to 32 accepted characters |
| `timeframe` | No | `1m` | `1d`, `7d`, `1m`, `3m`, `1y`, `5y` |
| `theme` | No | `light` | `light`, `dark` |
| `fill` | No | `false` | `true`, `false` |
| `format` | No | `svg` | `svg`, `json` |

Ticker input is trimmed and normalized to uppercase. Slash symbols such as `BTC/USD`, `XAU/USD`, and `USD/CAD` are valid. Unsupported, unknown, or duplicated parameters are rejected rather than ignored. Equivalent defaults and casing are canonicalized before cache lookup.

Chart dimensions are fixed at `160 × 48`. Consumers resize SVGs through normal HTML attributes or CSS; width and height are not cache dimensions.

### SVG response

SVG is the default response format:

```http
HTTP/1.1 200 OK
Content-Type: image/svg+xml; charset=utf-8
ETag: "..."
X-Request-Id: ...
X-Data-As-Of: 2026-07-10T00:00:00.000Z
X-Cache: HIT
```

Successful SVGs contain generated paths, a title, and a description. The same normalized series, render options, and renderer version must produce byte-identical output.

### JSON response

Set `format=json` to return quote data and the rendered SVG:

```json
{
  "ticker": "AAPL",
  "timeframe": "1m",
  "price": 314.98,
  "referencePrice": 296.34,
  "change": 18.64,
  "changePercent": 6.29,
  "direction": "up",
  "dataAsOf": "2026-07-10T00:00:00.000Z",
  "svg": "<svg ...>...</svg>"
}
```

`currency` is included only when the provider mapping supplies it reliably. `price` is the latest close. `change` is `price - referencePrice`; `changePercent` is that change expressed in percentage points and is `null` when the reference is zero. `direction` is `up`, `down`, or `flat`.

Provider identity, raw points, cache internals, and renderer configuration are not public response fields.

### Errors

JSON mode uses semantic HTTP statuses:

| Status | Code | Meaning |
| --- | --- | --- |
| `400` | `INVALID_REQUEST` | Missing, duplicated, unknown, or invalid input |
| `404` | `TICKER_NOT_FOUND` | No supported symbol resolved |
| `405` | `INVALID_REQUEST` | Unsupported HTTP method |
| `422` | `INSUFFICIENT_DATA` | The symbol cannot produce a chart for the requested range |
| `429` | `RATE_LIMITED` | Fair-use protection rejected the request |
| `502` | `PROVIDER_ERROR` | The upstream provider failed and no acceptable cached data exists |
| `503` | `SERVICE_UNAVAILABLE` | The service cannot fulfill the request |

JSON errors contain a stable public code, safe message, and request ID.

SVG-mode failures remain embeddable. They return HTTP `200`, a deterministic gray fallback sparkline, and the underlying semantic error in `X-Error-Code` and `X-Error-Status`. The fallback body includes the public error code but never includes the ticker, request ID, provider response, or stack trace. Clients that require semantic HTTP statuses use `format=json`.

### Other routes

- `GET /health` returns `{ "status": "ok" }` without calling the provider.
- `GET /status` returns coarse API and market-data availability based on recent provider refreshes. It never calls the provider.
- `GET /` serves the product page and API documentation.
- `GET /robots.txt` and `GET /sitemap.xml` serve crawler metadata.

## Market data and quote semantics

London Strategic Edge is the market-data provider. Provider access, authentication, symbol aliases, retries, validation, and normalization remain behind an internal adapter.

The source interval and plotted-point target depend on the requested range:

| Timeframe | Provider interval | Target points |
| --- | --- | --- |
| `1d` | `15m` | 128 |
| `7d` | `1h` | 168 |
| `1m` | `1d` | 31 |
| `3m` | `1d` | 92 |
| `1y` | `1d` | 250 |
| `5y` | `1w` | 250 |

For `1d`, ticker-line makes one widened provider request. Exchange-traded instruments use the last close before the latest detected session gap as `referencePrice` and show the latest session. Continuously traded crypto and forex use the first visible close in the trailing 24-hour window. Longer timeframes use the first visible close.

Provider rows are parsed as UTC, deduplicated by timestamp, sorted, and filtered to finite closes. A response with no usable points maps to `INSUFFICIENT_DATA`.

The public sample set covers:

- Apple — `AAPL`
- Bitcoin — `BTC/USD`
- S&P 500 — `SPY`
- Nasdaq 100 — `NAS100/USD`
- Gold — `XAU/USD`
- USD / CAD — `USD/CAD`

Coverage is provider-dependent and does not guarantee every market or ticker.

## Rendering contract

- Intrinsic size and view box are always `160 × 48`.
- A dotted horizontal line marks `referencePrice`.
- Price segments above the reference are green; segments below are red.
- When `fill=true`, each positive or negative region is filled to the reference line with the matching directional color.
- Light and dark themes use controlled accessible palettes.
- Valid points are sampled deterministically while preserving chronological order and overall shape.
- Flat and sparse finite series must remain visible and must not generate `NaN`, `Infinity`, or invalid XML.
- User and provider text is escaped before entering the SVG.

Color is semantic and is not a public request parameter.

## Freshness and caching

Normalized market data is cached independently from rendered SVG and JSON responses so visual variants share provider results.

| Timeframe | Fresh for | Additional stale window |
| --- | --- | --- |
| `1d` | 25 minutes | 1 hour |
| `7d` | 100 minutes | 6 hours |
| `1m` | 5 hours | 1 day |
| `3m` | 10 hours | 1 day |
| `1y` | 20 hours | 3 days |
| `5y` | 5 days | 7 days |

Browser freshness is at most 60 seconds. Shared-cache freshness follows the remaining data freshness. `stale-while-revalidate` and `stale-if-error` advertise the bounded stale window.

When a data record is stale but still acceptable, the request receives the stale chart immediately and a background refresh is attempted. A failed refresh applies a one-minute retry backoff. Expired data is not served.

Not-found results are cached for five minutes and insufficient-data results for ten minutes. Response and data cache keys include explicit renderer, normalization, provider, and policy versions so behavior changes can roll forward without a destructive purge.

Clients can inspect `X-Cache`, `X-Data-As-Of`, `ETag`, and JSON `dataAsOf`. Conditional `If-None-Match` requests receive `304` when appropriate.

## Fair use, security, and privacy

The anonymous API is a shared service. Clients should cache responses, avoid needless polling, and respect fair use.

Requests to `/v1/sparkline` are rate-limited by `CF-Connecting-IP` using two edge controls:

- 20 requests per 10 seconds for bursts.
- 60 requests per 60 seconds for sustained traffic.

The controls are abuse protection, not exact global accounting; Cloudflare applies them at the edge. A rejected request maps to `RATE_LIMITED` and includes `Retry-After` when available.

The IP value is used as the rate-limit key and is not emitted by the application logger. Operational logs include request IDs, route, method, outcome, duration, canonical request options, cache state, and sanitized provider failure metadata. They exclude provider credentials, raw provider bodies, response bodies, full IP addresses, and full user-agent strings.

The documentation site stores only the selected theme in local storage. No user account or browser API key is required.

Security invariants:

- Provider credentials remain Worker secrets and never enter URLs, caches, logs, or responses.
- Inputs are allowlisted, length-bounded, and canonicalized before cache lookup.
- Successful and fallback SVGs use controlled elements and attributes only.
- SVG responses set a restrictive content security policy and `nosniff`.
- Public errors never expose upstream bodies, internal URLs, or stack traces.
- API responses allow cross-origin reads and expose only documented operational headers.

## Reliability and operations

The service favors cached delivery and bounded degradation over provider-call amplification. Provider requests have a fixed overall deadline, bounded response size, bounded point count, and at most one retry for transient failures while time remains.

Structured logs distinguish `chart`, `fallback`, and `json_error` outcomes. Production and staging use separate Workers, KV namespaces, rate-limit namespaces, secrets, and observability settings.

The stable operational signals are:

- valid charts served;
- generated-response and market-data cache states;
- provider call volume, latency, and failure class;
- stale responses and background refresh failures;
- public error-code distribution;
- Worker latency and exceptions;
- rate-limit rejections.

`/health` is a Worker liveness check. `/status` is the consumer-facing service signal: it reports `operational`, `degraded`, `unavailable`, or `unknown` for market data and always reports the responding API component as operational. Successful provider refreshes record `operational`; provider-wide transient failures record `degraded`; authentication failures record `unavailable`. Ticker-specific lookup and insufficient-data failures do not change global status.

Status observations are written asynchronously after real provider refresh attempts. Cache hits do not write status, and status reads never trigger provider traffic. An observation older than one hour becomes `unknown`. The public response contains only coarse state, observation time, and a safe message—not provider identity, quotas, upstream errors, or internal diagnostics.

## Website requirements

The public site is a minimal, indexable documentation page that works without client JavaScript. JavaScript progressively enhances the theme toggle, service-status indicator, sample cards, request builder, copy actions, and preview.

The page includes:

- a clear value proposition and live URL;
- six representative market cards;
- a request builder for all public parameters;
- shared example state so cards, presets, URLs, preview alt text, HTML, Markdown, copy targets, and the JSON response stay synchronized;
- HTML and Markdown examples;
- request, response, error, freshness, and fair-use documentation;
- responsive desktop and mobile layouts;
- semantic headings, keyboard operation, descriptive alt text, and automated accessibility coverage;
- canonical, Open Graph, structured-data, robots, sitemap, favicon, and social-card metadata.

## Compatibility and evolution

The `/v1` route is compatibility-sensitive. Parameter names and semantics, response fields, error codes, directional colors, reference-price behavior, and rendering geometry should not change silently.

Optional JSON fields may be added within `v1`. Existing fields are not renamed or removed. Visible rendering changes require an intentional renderer-version increment and updated visual fixtures. Cache schema or normalization changes require their matching version increment.

Potential future additions—additional providers, exchange disambiguation, PNG output, authentication, higher limits, or new rendering options—must preserve the one-URL primary experience and enter the public contract deliberately.

## Product boundaries

ticker-line does not provide:

- real-time or tick-level guarantees;
- candlesticks, volume, axes, tooltips, or interactive charting;
- trading, portfolios, alerts, or financial analysis;
- symbol search or market discovery;
- user accounts, billing, or issued client keys;
- arbitrary dimensions, colors, CSS, fonts, SVG fragments, or date ranges;
- guaranteed coverage of every symbol, exchange, or asset class.

## Provider and legal requirements

Market-data caching and public derived-display rights must remain confirmed for every provider. Attribution, delayed-data obligations, commercial-use terms, storage limits, and provider rate limits are reviewed before changing provider behavior.

Charts may be delayed or contain errors and are not financial advice. The website communicates fair use, source attribution, data freshness, and the financial disclaimer.

## References

- [London Strategic Edge data overview](https://londonstrategicedge.com/data/#overview)
- [London Strategic Edge API documentation](https://londonstrategicedge.com/api-documentation/)
- [London Strategic Edge terms](https://londonstrategicedge.com/terms-of-service)
- [Cloudflare Workers](https://developers.cloudflare.com/workers/)
- [Cloudflare Workers KV](https://developers.cloudflare.com/kv/)
- [Cloudflare Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/)
- [Cloudflare Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
