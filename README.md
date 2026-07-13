# Ticker Line

[ticker-line](https://ticker-line.com) turns a market symbol and timeframe into a small, cacheable SVG chart. It is a public Cloudflare Worker API with no client API key required.

```text
https://ticker-line.com/v1/sparkline?ticker=AAPL&timeframe=1m
```

Embed the response anywhere images work:

```html
<img
  src="https://ticker-line.com/v1/sparkline?ticker=AAPL&timeframe=1m"
  alt="AAPL price over one month"
  width="160"
  height="48"
/>
```

Set `format=json` to receive the quote data and rendered SVG together:

```sh
curl "https://ticker-line.com/v1/sparkline?ticker=BTC%2FUSD&timeframe=1d&format=json"
```

See the [live documentation](https://ticker-line.com) for parameters, examples, error behavior, and cache freshness.

## How it works

The Worker is written in strict TypeScript with Hono and Zod. Astro builds the static documentation site, Cloudflare KV caches normalized market data, and the Cache API stores rendered responses. Requests are rate-limited at the edge and failures in SVG mode return an embeddable fallback image.

Market data is provided by [London Strategic Edge](https://londonstrategicedge.com/data#overview).

## Development

Requires Node.js 22.12 or newer and an [LSE API key](https://londonstrategicedge.com/data#api).

```sh
npm ci
cp .dev.vars.example .dev.vars
```

Add your key to `.dev.vars`, then start the API or documentation site:

```sh
npm run dev:api
npm run dev:site
```

Run the full local gate before committing:

```sh
npm run check
npm run test:visual
npm run test:e2e
```

Provider calls are mocked in the default test suite. See [the implementation guide](docs/implementation.md) for architecture, cache policy, operations, and deployment details, and [the PRD](docs/prd.md) for the public contract.

## API

`GET /v1/sparkline` accepts `ticker`, `timeframe`, `theme`, `fill`, and `format`. SVG is the default. JSON mode provides quote data, the rendered SVG, and semantic error responses.

Market data may be delayed or contain errors. Ticker Line is not financial advice.

## Contributing and security

Read [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md) before opening a change. Report vulnerabilities according to [SECURITY.md](SECURITY.md), not through a public issue.

## License

[MIT](LICENSE)
