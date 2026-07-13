# Contributing

Thanks for helping improve Ticker Line.

## Before you start

- Open an issue for public API changes, new providers, or significant dependencies.
- Keep the URL contract small and provider-neutral.
- Never commit provider credentials, response dumps containing sensitive fields, or `.dev.vars`.
- Keep changes focused and use conventional, atomic commit messages where practical.

## Local workflow

```sh
npm ci
cp .dev.vars.example .dev.vars
npm run check
npm run test:visual
npm run test:e2e
```

Add or update tests for behavioral changes. Renderer changes require visual coverage. UI changes must remain keyboard usable, responsive, and free of automated Axe violations.

## Pull requests

Explain the problem, the chosen approach, and verification performed. Note any API, cache-key, provider, infrastructure, or legal-data implications explicitly.
