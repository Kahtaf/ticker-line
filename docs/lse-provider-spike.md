# LSE Provider Spike

- **Status:** Complete
- **Run date:** 2026-07-12
- **Provider:** London Strategic Edge (LSE)
- **Live-call budget:** 15 calls maximum
- **Live calls made:** 15
- **Related documents:** [`docs/prd.md`](./prd.md), [`docs/implementation.md`](./implementation.md)

## 1. Purpose

This spike closes the highest-risk implementation questions around the LSE candle API before the provider adapter is built. It covers timestamp semantics, provisional candles, price adjustments, international and ambiguous symbols, the `dataset` discriminator, catalog filtering, error envelopes, and metadata availability.

The product owner has confirmed written LSE permission for automated use, caching, derived public SVG redistribution, and commercial use. That permission is accepted as a project fact and was not re-evaluated by this spike.

## 2. Method and safety controls

- Read the PRD and implementation specification in full before testing.
- Used `LSE_API_KEY` from the gitignored `.dev.vars` file only as an in-process request header.
- Never printed the key, placed it in a URL, persisted it, or included it in a command argument.
- Logged only response status, byte count, field names, row count, symbol, timestamp bounds, and narrowly selected candle values needed to establish provisional-candle behavior.
- Capped catalog reads at approximately 256 KiB and aborted the stream instead of downloading the roughly 8.5 MB catalog.
- Did not attempt to exhaust the rate limit or monthly allowance.
- Did not mutate provider state.

Primary provider references:

- [Official REST API overview](https://londonstrategicedge.com/free-market-data-api/)
- [Official API reference surface](https://londonstrategicedge.com/docs/api/)
- [Official `lse-data` client and examples](https://github.com/londonstrategicedge/lse-data)
- [Official UTC-oriented data loading guide](https://londonstrategicedge.com/data/guides/load-in-python/)

## 3. Sanitized live evidence

### Candles and symbols

| Probe | Status | Sanitized observation |
| --- | ---: | --- |
| `BTC/USD`, `1m`, descending, limit 5 | 200 | Five rows; candle fields were `ts`, `symbol`, `open`, `high`, `low`, `close`, `volume`. At response time `20:29:33 GMT`, the newest row was timestamped `2026-07-12 20:29:00.000000`. |
| Second `BTC/USD`, `1m` observation | 200 | The newest row advanced to `2026-07-12 20:30:00.000000`. |
| `BTC-USD`, `1m` | 404 | Returned a `detail` string containing nested/stringified JSON saying the symbol had no candle data. |
| `AAPL`, `15m`, two recent sessions | 200 | 128 rows from `08:00` through `23:45` UTC-like timestamps, confirming extended-hours coverage. |
| `AAPL`, `1d` | 200 | 27 rows; timestamps were timezone-less midnight values. |
| `VOD.L`, `1d` | 200 | 36 rows; the exact international suffix syntax works. |
| `VOD`, `1d` | 200 | Returned a separate valid series for symbol `VOD`; it must not be treated as an alias for `VOD.L`. |
| `BTC/USD`, `dataset=crypto` | 200 | Returned the expected rows. |
| `BTC/USD`, `dataset=stocks` | 200 | Returned an empty JSON array, not a 404 or validation error. |

### Catalog

Three catalog requests tried `symbol=VOD.L&limit=5`, `search=VOD&limit=5`, and `dataset=stocks&limit=5`. Every request still streamed beyond the 256 KiB safety cap and was aborted. The `dataset=stocks` response still began with the `crypto` / `BTC/USD` record. These query parameters therefore did not filter or limit `/catalog` in the tested HTTP contract.

The first catalog object exposed these fields:

```text
dataset, symbol, name, ticks, first_tick, last_tick, years,
last_value, change_pct, change_1y, unit, source, category,
frequency, country, country_name
```

For the first `BTC/USD` row, `dataset` was `crypto`, while `unit`, `source`, `category`, `frequency`, `country`, and `country_name` were empty strings. The catalog did not expose explicit exchange or timezone fields.

### Error envelopes

| Probe | Status | Sanitized body shape |
| --- | ---: | --- |
| Missing `x-api-key` | 401 | `{ "detail": "missing x-api-key" }` |
| Invalid `x-api-key` | 401 | `{ "detail": "invalid api key" }` |
| Missing required `symbol` | 422 | A `detail` string containing nested/stringified validation JSON. |
| Unknown symbol | 404 | A `detail` string containing nested/stringified error JSON. |

A 403 was not reproducible through a safe, valid candle request: both missing and invalid credentials produced 401. Eliciting a real 403 would likely require a suspended/under-entitled key or probing a restricted operation, neither of which was appropriate. The adapter must still handle 403 as a permanent provider authorization/permission failure and sanitize its body.

A 429 was deliberately not forced. The existing evaluated allowance is 200 requests per minute. The adapter should treat 429 as transient, read `Retry-After` when present, perform no immediate retry, and prefer stale data.

## 4. Findings

### 4.1 Timestamp semantics

LSE emits timezone-less strings such as `2026-07-12 20:29:00.000000`; the candle payload itself does not carry an offset or timezone. The official data-loading guide describes the timestamp index as UTC, and observed US extended-hours boundaries are consistent with UTC: `08:00` corresponds to 04:00 New York time during daylight saving time.

Adapter decision:

- Parse LSE candle timestamps explicitly as UTC; do not use environment-dependent `new Date("YYYY-MM-DD HH:mm:ss")` parsing.
- Convert with a strict parser or transform the validated provider value to an ISO UTC form before `Date.parse`.
- Store epoch milliseconds internally and ISO 8601 UTC at storage/HTTP boundaries.
- Treat timestamps as provider candle labels, not proof that a local exchange session was open. One observed `VOD.L` daily row was labeled on a Saturday, so session logic must not be inferred from timestamp weekday alone.

### 4.2 Incomplete candle and update cadence

The first crypto observation returned the candle for the minute that was still in progress: the response arrived at `20:29:33 GMT` and included the `20:29:00` candle. A later observation advanced to the `20:30:00` candle. This establishes that the latest candle is provisional and that one-minute crypto data can update at least once per minute. It does not establish an exact within-minute tick cadence.

Adapter/cache decision:

- Preserve the final provider candle.
- Treat it as provisional in product documentation and cache policy.
- Align active crypto refreshes to the source candle boundary plus a small publication buffer; do not promise tick-level freshness.
- For the public timeframe mapping, continue to use the coarser intervals in the implementation specification rather than polling one-minute data unless a future product requirement needs it.

### 4.3 Stock and ETF adjustments

The provider documentation describes stock and ETF candles as split-adjusted. Candle rows expose only OHLCV fields: there is no raw close, adjusted close, adjustment mode, or factor. LSE exposes dividends and splits as separate reference feeds.

The most defensible simple policy is therefore:

- Accept the provider `close` exactly as returned.
- Describe the series as **split-adjusted**, not dividend-adjusted or total-return adjusted.
- Do not add client-side corporate-action logic in V1.
- Do not imply dividend reinvestment or total-return performance.

The live candle shape cannot independently prove the absence of dividend adjustment. Written provider confirmation would be the only definitive closure, but it is not required for the agreed V1 split-adjusted policy.

### 4.4 International and ambiguous symbols

`VOD.L` succeeds exactly as documented. `VOD` also succeeds but resolves to its own series. This is a concrete ambiguity case: stripping an exchange suffix or guessing a preferred listing would silently change the instrument.

Adapter decision:

- Preserve dots and exact suffixes in canonical public symbols.
- Never map an unsuffixed equity symbol to an international listing.
- Keep the only initial alias explicit and provider-specific: public `BTC-USD` maps to LSE `BTC/USD`.
- Return the provider-resolved symbol internally, but do not expose provider syntax in the V1 public contract beyond the documented canonical ticker.

### 4.5 `dataset` discriminator

`dataset` is a real filter on `/candles`: the correct `crypto` value returned BTC rows, while `stocks` returned an empty array. A dataset mismatch is therefore indistinguishable from an empty range if status alone is used.

Adapter decision:

- Supply `dataset` only when the adapter has a deterministic symbol classification.
- Treat `200 []` as no data first, not automatically as `TICKER_NOT_FOUND`.
- Do not expose `dataset` as a V1 public parameter.
- The simplest V1 implementation may omit `dataset` for candle fetches; exact symbols already resolved correctly in the tested stock, international stock, and crypto cases.

### 4.6 Catalog filtering

No tested server-side symbol, search, dataset, or limit query reduced `/catalog`. The official Python client documents category-oriented `catalog()` usage, but the raw query spellings tested here did not implement that behavior.

Adapter decision:

- Never call `/catalog` in a sparkline request.
- Do not add catalog-driven symbol validation to V1.
- If discovery or metadata enrichment is added later, use the official client contract to identify the exact category request grammar and build a bounded, out-of-band snapshot.

### 4.7 Metadata availability

`/candles` exposes no currency, exchange, timezone, or asset-type field. `/catalog` exposes a `dataset` classifier and general descriptive fields, but no explicit exchange/timezone, and the tested BTC metadata fields that might hold unit/category were empty.

Adapter decision:

- Derive `assetType` only from deterministic adapter routing or explicit alias tables; otherwise use `unknown`.
- Do not invent exchange or timezone.
- Do not infer currency from a stock suffix. The `BTC/USD` quote component can safely yield `USD`, but that rule does not generalize to equities.
- Keep `currency`, `exchange`, and `timezone` optional in the internal domain model.

This reveals one public-contract issue for implementers: the PRD's successful JSON example includes `currency`, but the provider candle response cannot supply it reliably for arbitrary equities. The simplest correct V1 choice is to make `currency` optional in JSON and omit it when unknown. If the PRD requires it unconditionally, a separate symbol-metadata source or maintained metadata snapshot is required.

## 5. Error mapping decisions

| Provider outcome | Internal treatment |
| --- | --- |
| 200 with valid rows | Normalize and return series. |
| 200 with empty array | `INSUFFICIENT_DATA` unless independent resolution evidence proves the symbol does not exist. |
| 401 or 403 | Permanent provider authentication/authorization failure for the request; no retry; map to sanitized `PROVIDER_ERROR` or service configuration error. |
| 404 unknown symbol | `TICKER_NOT_FOUND`; never expose nested provider detail. |
| 422 | Provider request/schema error; no retry; log only sanitized field/status metadata. |
| 429 | Transient rate limit; no immediate retry; honor `Retry-After`; prefer stale data. |
| 5xx/network timeout | Transient provider error; at most one bounded retry when budget remains; prefer stale data. |

Provider error bodies are inconsistent and sometimes double-encoded. The adapter should branch on status first and treat the body as untrusted optional diagnostics. It should not depend on recursively parsing `detail` for normal control flow.

## 6. Recommended adapter contract

Use the existing native `fetch` design with these LSE-specific rules:

```text
base URL: https://api.londonstrategicedge.com/vault
endpoint: GET /candles
auth: x-api-key header
symbol alias: BTC-USD -> BTC/USD
timeframes: 15m, 1h, 1d, 1w for the initial public mapping
timestamps: strict timezone-less provider format, interpreted as UTC
latest candle: preserved and provisional
adjustment: provider split-adjusted close as-is
dataset: omit initially unless classification is deterministic
metadata: never synthesize exchange/timezone/currency
```

Fixtures should cover:

- normal AAPL, `VOD.L`, and `BTC/USD` rows;
- the `BTC-USD` adapter alias;
- current/provisional final candle;
- `200 []` from a dataset mismatch;
- direct-detail 401;
- nested/stringified-detail 404 and 422;
- synthetic 403, 429 with and without `Retry-After`, malformed JSON, oversized body, timeout, and 5xx.

## 7. Unresolved questions

These do not block the provider adapter if the decisions above are followed:

1. LSE should confirm in writing whether split-adjusted candles categorically exclude dividend adjustment. V1 can proceed using the documented split-adjusted description.
2. The precise meaning of occasional international daily labels that fall on a weekend needs provider clarification before exchange-calendar-aware freshness is claimed.
3. A real 403 body and real 429 body were not safely reproducible. Tests must use synthetic fixtures and status-first handling.
4. Reliable equity currency/exchange/timezone metadata requires either a new provider endpoint, an out-of-band catalog/reference snapshot, or a public contract that permits omission.

## 8. Call accounting

Exactly 15 live provider calls were made:

- 5 initial candle/symbol probes;
- 2 bounded catalog filter probes;
- 3 ambiguity/dataset probes;
- 4 authentication, malformed-request, and second-observation probes;
- 1 final bounded catalog dataset-filter probe.

No rate-limit, quota-exhaustion, export-job, WebSocket, or state-mutating calls were made.
