# Sifting provider evaluation

Evaluated on 2026-07-31 against the public Sifting documentation, symbol catalog, pricing page, and live REST API using the local `SIFTING_API_KEY`. No credential or raw production response is stored in this repository.

## Decision

Sifting is technically suitable as the first provider in an ordered chain, with LSE retained as fallback. It directly covers ticker-line's US security, crypto, FX, and commodity shapes. It does not expose an index-history endpoint or a catalog entry for the Nasdaq 100 instrument used by ticker-line, so `NAS100/USD` must continue through LSE. `QQQ` exists in Sifting's stock catalog but is an ETF, not an equivalent Nasdaq 100 index instrument, and is deliberately not used as a substitute. The current key also returned `403 feature not available on the free tier` for historical stocks; the chain handles that entitlement miss by using LSE.

Do not deploy the Sifting integration to the public service until the account's customer-facing usage rights are confirmed. Sifting's current pricing page describes its Free tier as internal, non-commercial use and describes customer-facing display as a higher-tier capability. The current production use case is a public derived-display API.

## Documented API contract

Authentication uses `X-API-Key`. Historical endpoints require gzip negotiation and return a shared `{ data, meta }` envelope with epoch-millisecond OHLCV bars:

| Market | Endpoint | Provider symbol examples |
| --- | --- | --- |
| US securities | `/v1/hist/stocks/:ticker/bars` | `AAPL`, `SPY`, `QQQ` |
| Crypto | `/v1/hist/crypto/:symbol/bars` | `BTCUSD`, `ETHUSD`, `SOLUSD` |
| Forex | `/v1/hist/forex/:pair/bars` | `EURUSD`, `USDCAD` |
| Commodities | `/v1/hist/commodities/:symbol/bars` | `XAUUSD`, `XAGUSD`, `WTIUSD` |

The required public `market` parameter chooses the endpoint. The adapter translates slash syntax at the boundary but does not embed Sifting's symbol catalog, infer a market from a ticker, or replace one instrument with a proxy. `market=index` bypasses Sifting because Sifting has no index-history endpoint; `NAS100/USD` is not silently mapped to `QQQ`.

## Live probe results

The probe used bounded date ranges and response summaries only.

| Request | Result |
| --- | --- |
| `AAPL`, stocks, `1d` | `403`; this key lacks `hist_stocks` |
| `SPY`, stocks, `1d` | `403`; this key lacks `hist_stocks` |
| `BTCUSD`, crypto, `15m` | `200`; 97 ordered bars for a one-day window |
| `BTCUSD`, crypto, `1d` | `200`; 30 bars for one month and 365 for one year |
| `ETHUSD`, crypto, `1d` | `200` |
| `SOLUSD`, crypto, `1d` | `200`, but only six bars were available in the requested month |
| `USDCAD`, forex, `1h` and `1d` | `200` |
| `EURUSD`, forex, `1d` | `200` |
| `XAUUSD`, commodities, `1d` | `200` |
| `NAS100` via stocks | `403` before symbol resolution because stocks are not enabled for the key |
| `NAS100USD` via forex | `400`; forex requires a six-character currency pair |

The live crypto and forex endpoints accepted `1d`, even though their endpoint prose still listed intraday intervals in places. All crypto, forex, and commodity endpoints rejected `1w`. The adapter therefore converts weekly requests for those markets to daily bars before ticker-line's deterministic sampling. Stocks retain native weekly bars.

Five-year daily FX and commodity requests returned a cursor before the requested end. A second request must keep the original `end`, `interval`, and `limit` while replacing `start` with `cursor`; sending only the cursor reverted the observed cadence to `1m`. The adapter implements the working form with a three-page, 5,000-point, 2 MiB, 10-second aggregate bound. A cold five-year BTC request exceeded a 30-second probe timeout, so LSE remains important for slow deep-history requests.

## Error and quota observations

- `401` and invalid/unenabled `403` access are non-retriable within the Sifting adapter and may move to LSE.
- `404` is a symbol/capability miss and may move to LSE.
- `422 data_unavailable` may move to LSE for broader historical coverage.
- `429` is not retried and retains `Retry-After` when supplied.
- Network and `5xx` failures receive at most one retry while the overall deadline remains.
- The pricing page currently advertises per-market Free quotas of 10,000 REST calls per month, 60 requests per minute, and one month of historical depth. Live observations exceeded one month for some enabled markets, but the implementation must not rely on undocumented entitlement behavior.

## Sources

- [Sifting API documentation](https://sifting.io/docs)
- [Historical stocks](https://sifting.io/docs/historical/stocks)
- [Historical crypto](https://sifting.io/docs/historical/crypto)
- [Historical forex](https://sifting.io/docs/historical/forex)
- [Historical commodities](https://sifting.io/docs/historical/commodities)
- [Symbol catalog](https://sifting.io/symbols)
- [Pricing](https://sifting.io/pricing)
- [Terms of use](https://sifting.io/legal/terms-of-use)
