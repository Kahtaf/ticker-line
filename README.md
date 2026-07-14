# ticker-line

[![CI](https://github.com/Kahtaf/ticker-line/actions/workflows/ci.yml/badge.svg)](https://github.com/Kahtaf/ticker-line/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-111111.svg)](LICENSE)

Market sparklines through a URL. ticker-line turns a market symbol and timeframe into a small, cacheable SVG for HTML, Markdown, dashboards, and anywhere else images work.

```text
https://ticker-line.com/v1/sparkline?ticker=AAPL&timeframe=1m
```

![AAPL price over one month](https://ticker-line.com/v1/sparkline?ticker=AAPL&timeframe=1m&fill=true)

The public API requires no client API key. See the [live documentation](https://ticker-line.com) for the interactive request builder, response contract, errors, and cache freshness.

## Quick start

Use the SVG directly as an image:

```html
<img
  src="https://ticker-line.com/v1/sparkline?ticker=AAPL&timeframe=1m"
  alt="AAPL price over one month"
  width="160"
  height="48"
/>
```

Or in Markdown:

```markdown
![AAPL price over one month](https://ticker-line.com/v1/sparkline?ticker=AAPL&timeframe=1m)
```

Set `format=json` to receive quote data and the rendered SVG together:

```sh
curl "https://ticker-line.com/v1/sparkline?ticker=BTC%2FUSD&timeframe=1d&format=json"
```

## Examples

These are the same examples available in the live request builder.

| Market     | Ticker       | Live chart                                                                                     |
| ---------- | ------------ | ---------------------------------------------------------------------------------------------- |
| Apple      | `AAPL`       | ![AAPL sparkline](https://ticker-line.com/v1/sparkline?ticker=AAPL&timeframe=1m)               |
| Bitcoin    | `BTC/USD`    | ![BTC/USD sparkline](https://ticker-line.com/v1/sparkline?ticker=BTC%2FUSD&timeframe=1m)       |
| S&P 500    | `SPY`        | ![SPY sparkline](https://ticker-line.com/v1/sparkline?ticker=SPY&timeframe=1m)                 |
| Nasdaq 100 | `NAS100/USD` | ![NAS100/USD sparkline](https://ticker-line.com/v1/sparkline?ticker=NAS100%2FUSD&timeframe=1m) |
| Gold       | `XAU/USD`    | ![XAU/USD sparkline](https://ticker-line.com/v1/sparkline?ticker=XAU%2FUSD&timeframe=1m)       |
| USD / CAD  | `USD/CAD`    | ![USD/CAD sparkline](https://ticker-line.com/v1/sparkline?ticker=USD%2FCAD&timeframe=1m)       |

Ticker symbols must be supported by [London Strategic Edge](https://londonstrategicedge.com/data/#overview).

## API

`GET https://ticker-line.com/v1/sparkline`

| Parameter   | Required | Default | Values                             |
| ----------- | -------- | ------- | ---------------------------------- |
| `ticker`    | Yes      | —       | A supported market symbol          |
| `timeframe` | No       | `1m`    | `1d`, `7d`, `1m`, `3m`, `1y`, `5y` |
| `theme`     | No       | `light` | `light`, `dark`                    |
| `fill`      | No       | `false` | `true`, `false`                    |
| `format`    | No       | `svg`   | `svg`, `json`                      |

Successful JSON responses include the normalized ticker, timeframe, latest price, reference price, absolute and percentage change, direction, source timestamp, and rendered SVG:

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

SVG requests remain embeddable when something goes wrong: the API returns a gray fallback chart with error details in response headers. JSON requests use semantic HTTP status codes. Responses are cached at the edge, and freshness depends on the timeframe, asset type, and market session.

`GET /health` is a lightweight Worker liveness check. `GET /status` reports coarse API and market-data availability from recent provider refreshes without making a provider request.

## Development

Requirements:

- Node.js 22.12 or newer
- An [LSE API key](https://londonstrategicedge.com/data#api)
- Wrangler authentication for deployment only

Install dependencies and configure the local Worker:

```sh
npm ci
cp .dev.vars.example .dev.vars
```

Add your LSE key to `.dev.vars`, then start the API or documentation site:

```sh
npm run dev:api
npm run dev:site
```

Useful commands:

| Command               | Purpose                                                             |
| --------------------- | ------------------------------------------------------------------- |
| `npm run check`       | Formatting, linting, typechecking, unit tests, and production build |
| `npm run test:visual` | Renderer image-regression tests                                     |
| `npm run test:e2e`    | Browser and accessibility tests                                     |
| `npm run build`       | Static site build and Worker dry run                                |

The default test suite uses provider fixtures and does not call the live LSE API.

## Architecture

- **Cloudflare Workers** serves the API and static documentation site.
- **Hono** handles HTTP routing and middleware.
- **Zod** validates public requests, provider data, and cached records.
- **Cloudflare KV** caches normalized market series.
- **Cache API** stores rendered SVG and JSON responses at the edge.
- **Astro** builds the documentation site.
- **Vitest and Playwright** cover unit, visual, browser, and accessibility behavior.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md) before opening an issue or pull request. Report vulnerabilities privately according to [SECURITY.md](SECURITY.md).

Market data is provided by [London Strategic Edge](https://londonstrategicedge.com/data/#overview). Data may be delayed or contain errors. ticker-line is not financial advice.

## License

[MIT](LICENSE)
