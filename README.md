# Ticker Line

Ticker Line turns a market symbol and timeframe into a small, cacheable SVG chart.

```html
<img
  src="https://ticker-line.com/v1/sparkline?ticker=AAPL&timeframe=1m"
  alt="AAPL price over one month"
  width="160"
  height="48"
/>
```

The Worker is written in strict TypeScript with Hono and Zod. Astro builds the static documentation site, Cloudflare KV caches normalized market data, and the Cache API stores rendered responses.

## Development

Requires Node.js 22.12 or newer and an LSE API key.

```sh
npm ci
cp .dev.vars.example .dev.vars
npm run dev:api
```

Run the full local gate before committing:

```sh
npm run check
npm run test:visual
npm run test:e2e
```

See [the PRD](docs/prd.md) for the public contract and [the implementation specification](docs/implementation.md) for architecture, cache policy, operations, and test strategy.

## API

`GET /v1/sparkline` accepts `ticker`, `timeframe`, `theme`, `fill`, and `format`. SVG is the default. JSON mode provides semantic error responses and response metadata.

Market data may be delayed or contain errors. Ticker Line is not financial advice.

## Contributing and security

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a change. Report vulnerabilities according to [SECURITY.md](SECURITY.md), not through a public issue.

## License

[MIT](LICENSE)
