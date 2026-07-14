import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const validSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 48" width="160" height="48"><title>Test chart</title><path d="M2 40L42 30L82 34L122 12L158 8" fill="none" stroke="#236b43" stroke-width="2"/></svg>`;

test.beforeEach(async ({ page }) => {
  await page.route("**/status", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({
        status: "operational",
        components: {
          api: "operational",
          marketData: "operational",
        },
        updatedAt: "2026-07-13T21:00:00.000Z",
        message: "The API and market data are operating normally.",
      }),
    }),
  );
  await page.route("**/v1/sparkline?*", (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.searchParams.get("format") === "json") {
      const ticker = requestUrl.searchParams.get("ticker") ?? "AAPL";
      const timeframe = requestUrl.searchParams.get("timeframe") ?? "1m";
      const isDown = ticker === "USD/CAD";
      return route.fulfill({
        status: 200,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify({
          ticker,
          timeframe,
          price: isDown ? 98.25 : 123.45,
          referencePrice: 120,
          change: isDown ? -1.75 : 3.45,
          changePercent: isDown ? -1.75 : 2.88,
          direction: isDown ? "down" : "up",
          dataAsOf: "2026-07-10T00:00:00.000Z",
          svg: validSvg,
        }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "image/svg+xml; charset=utf-8",
      body: validSvg,
    });
  });
});

test("renders indexable documentation and a live product example", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page).toHaveTitle(/Ticker Line/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Market sparklines through a URL",
  );
  await expect(page.getByText("Public API · v1")).toHaveCount(0);
  await expect(page.getByText("Live preview")).toHaveCount(0);
  const statusLink = page.locator("[data-service-status]");
  await expect(statusLink).toHaveAttribute("href", "/status");
  await expect(statusLink).toHaveAttribute("data-status", "operational");
  await expect(statusLink).toHaveAttribute(
    "aria-label",
    "Service status: operational",
  );
  await expect(statusLink).toHaveAttribute(
    "title",
    "The API and market data are operating normally.",
  );
  await expect(statusLink).toHaveText("Status");
  await expect(statusLink).toBeVisible();
  await expect(statusLink.locator("xpath=ancestor::footer")).toHaveCount(1);
  const githubLink = page.getByRole("link", { name: "GitHub" });
  await expect(githubLink).toHaveAttribute("target", "_blank");
  await expect(githubLink).toHaveAttribute("rel", "noopener noreferrer");
  await expect(page.getByRole("heading", { name: "Request" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Response" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Errors" })).toBeVisible();
  await expect(page.getByText("format=json", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy URL" })).toHaveCount(0);
  await expect(page.locator("#response .section-copy").first()).toHaveText(
    "Set format=json to return quote data and the rendered SVG in JSON. Leaving the format option out returns an embeddable SVG.",
  );
  await expect(page.getByText('"referencePrice": 296.34')).toBeVisible();
  await expect(
    page.getByText("changePercent is expressed in percentage points."),
  ).toBeVisible();
  await expect(
    page.locator('img[alt="AAPL price over one month"]'),
  ).toBeVisible();
  await expect(page.locator("#terms")).toContainText(
    "Fair use applies: requests are rate-limited per IP to protect the shared service.",
  );
});

test("loads common ticker presets into the live builder", async ({ page }) => {
  await page.goto("/");
  const builder = page.locator("[data-request-builder]");
  const tickers = [
    "AAPL",
    "BTC/USD",
    "SPY",
    "NAS100/USD",
    "XAU/USD",
    "USD/CAD",
  ];

  for (const ticker of tickers) {
    const encodedTicker = encodeURIComponent(ticker);
    const nextUrl = `https://ticker-line.com/v1/sparkline?ticker=${encodedTicker}&timeframe=1m`;
    const description = `${ticker} price over one month`;

    await builder.getByRole("link", { name: ticker, exact: true }).click();
    await expect(builder.getByLabel("Ticker")).toHaveValue(ticker);
    await expect(builder.locator("[data-generated-url]")).toHaveText(nextUrl);
    await expect(page.locator("[data-live-url]")).toHaveText(nextUrl);
    await expect(page.locator("[data-html-example]")).toContainText(
      `src="${nextUrl}"`,
    );
    await expect(page.locator("[data-html-example]")).toContainText(
      `alt="${description}"`,
    );
    await expect(page.locator("[data-markdown-example]")).toHaveText(
      `![${description}](${nextUrl})`,
    );
    await expect(page.locator("[data-json-example]")).toContainText(
      `"ticker": "${ticker}"`,
    );
  }
});

test("renders six market cards and synchronizes a card selection", async ({
  page,
}) => {
  await page.goto("/");
  const cards = page.locator("[data-market-card]");
  const gold = page.getByRole("button", { name: "Use Gold, XAU/USD" });
  const builder = page.locator("[data-request-builder]");

  await expect(cards).toHaveCount(6);
  await expect(cards.first()).toHaveAttribute("data-market-state", "ready");
  await expect(cards.first().locator("[data-market-price]")).toHaveText(
    "123.45",
  );

  await gold.click();

  await expect(gold).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-live-url]")).toHaveText(
    "https://ticker-line.com/v1/sparkline?ticker=XAU%2FUSD&timeframe=1d",
  );
  await expect(builder.getByLabel("Ticker")).toHaveValue("XAU/USD");
  await expect(builder.getByLabel("Timeframe")).toHaveValue("1d");
  await expect(builder.locator("[data-generated-url]")).toContainText(
    "ticker=XAU%2FUSD&timeframe=1d",
  );
  await expect(builder.locator("[data-preview-image]")).toHaveAttribute(
    "alt",
    "XAU/USD price over one day",
  );
  await expect(page.locator("[data-html-example]")).toContainText(
    'alt="XAU/USD price over one day"',
  );
  await expect(page.locator("[data-markdown-example]")).toHaveText(
    "![XAU/USD price over one day](https://ticker-line.com/v1/sparkline?ticker=XAU%2FUSD&timeframe=1d)",
  );
  await expect(page.locator("[data-json-example]")).toContainText(
    '"ticker": "XAU/USD"',
  );
  await expect(page.locator("[data-json-example]")).toContainText(
    '"timeframe": "1d"',
  );
});

test("toggles and persists the site theme", async ({ page }) => {
  await page.goto("/");
  const toggle = page.getByRole("button", { name: "Toggle site theme" });

  await page.evaluate(() => {
    localStorage.setItem("ticker-line-theme", "light");
    document.documentElement.dataset.theme = "light";
  });
  await toggle.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("updates the request URL and preview accessibly", async ({ page }) => {
  await page.goto("/");
  const builder = page.locator("[data-request-builder]");

  await builder.getByLabel("Ticker").fill("btc/usd");
  await builder.getByLabel("Timeframe").selectOption("7d");
  await builder.getByLabel("Theme").selectOption("dark");
  await builder.getByLabel("Fill").selectOption("true");

  await expect(builder.locator("[data-generated-url]")).toContainText(
    "ticker=BTC%2FUSD",
  );
  await expect(builder.locator("[data-generated-url]")).toContainText(
    "timeframe=7d",
  );
  await expect(builder.locator("[data-generated-url]")).toContainText(
    "theme=dark",
  );
  await expect(builder.locator("[data-generated-url]")).toContainText(
    "fill=true",
  );
  await expect(builder.locator("[data-preview-image]")).toHaveAttribute(
    "alt",
    "BTC/USD price over seven days",
  );
  await expect(builder.locator("[data-generated-url]")).toHaveText(
    /^https:\/\/ticker-line\.com\/v1\/sparkline\?/,
  );
  const synchronizedUrl =
    "https://ticker-line.com/v1/sparkline?ticker=BTC%2FUSD&timeframe=7d&theme=dark&fill=true";
  await expect(builder.locator("[data-generated-url]")).toHaveText(
    synchronizedUrl,
  );
  await expect(page.locator("[data-live-url]")).toHaveText(synchronizedUrl);
  await expect(page.locator("[data-html-example]")).toContainText(
    `src="${synchronizedUrl}"`,
  );
  await expect(page.locator("[data-markdown-example]")).toHaveText(
    `![BTC/USD price over seven days](${synchronizedUrl})`,
  );
  await expect(page.locator("[data-json-example]")).toContainText(
    '"timeframe": "7d"',
  );
  expect(
    await page.locator("[data-copy-html]").getAttribute("data-copy"),
  ).toContain(synchronizedUrl);
  await expect(page.locator("[data-copy-markdown]")).toHaveAttribute(
    "data-copy",
    `![BTC/USD price over seven days](${synchronizedUrl})`,
  );
});

test("accepts slash tickers and wraps complete URLs on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const builder = page.locator("[data-request-builder]");

  await builder.getByRole("link", { name: "XAU/USD" }).click();

  await expect(builder.getByLabel("Ticker")).toHaveValue("XAU/USD");
  await expect(builder.locator("[data-generated-url]")).toContainText(
    "https://ticker-line.com/v1/sparkline?ticker=XAU%2FUSD",
  );
  await expect(page.locator(".docs-nav")).toBeHidden();
  await expect(page.locator("[data-service-status]")).toBeVisible();
  await expect(page.locator("[data-service-status]")).toHaveText("Status");
  await expect(page.locator(".compact-code code")).toHaveText(
    "https://ticker-line.com/v1/sparkline?ticker=XAU%2FUSD&timeframe=1m",
  );
  expect(
    await page
      .locator(".compact-code code")
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  expect(
    await builder
      .locator("[data-generated-url]")
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
});

test("links ticker guidance to the LSE catalog", async ({ page }) => {
  await page.goto("/");
  const guidanceLinks = page.getByRole("link", {
    name: "London Strategic Edge",
  });
  await expect(guidanceLinks).toHaveCount(2);
  for (const link of await guidanceLinks.all()) {
    await expect(link).toHaveAttribute(
      "href",
      "https://londonstrategicedge.com/data/#overview",
    );
  }
  await expect(
    page.locator("#request tbody tr").first().locator("td").nth(2),
  ).toHaveText("Use a supported London Strategic Edge symbol.");
});

test("styles inline code and omits section dividers", async ({ page }) => {
  await page.goto("/");
  const inlineCode = page.locator("#response .section-copy code").first();

  await page.evaluate(() => {
    document.documentElement.dataset.theme = "light";
  });
  await expect(inlineCode).toHaveCSS("background-color", "rgb(242, 242, 242)");
  await expect(page.locator("#usage")).toHaveCSS("border-bottom-style", "none");
  await expect(page.locator(".site-footer")).toHaveCSS(
    "border-top-style",
    "none",
  );
  await expect(page.locator(".site-header")).toHaveCSS(
    "border-bottom-style",
    "none",
  );

  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  await expect(inlineCode).toHaveCSS("background-color", "rgb(26, 26, 26)");
});

test("gives the mobile hero room and sizes error chips to their text", async ({
  page,
}) => {
  await page.setViewportSize({ width: 559, height: 870 });
  await page.goto("/");

  await expect(page.locator(".intro")).toHaveCSS("padding-top", "30px");
  await expect(page.locator(".intro")).toHaveCSS("padding-bottom", "72px");

  const providerError = page.getByText("PROVIDER_ERROR", { exact: true });
  const chipWidth = await providerError.evaluate(
    (element) => element.getBoundingClientRect().width,
  );
  const gridTrackWidth = await providerError.evaluate((element) => {
    const parent = element.parentElement;
    const status = parent?.querySelector("span");
    if (!parent || !status) return 0;
    return (
      parent.getBoundingClientRect().right -
      status.getBoundingClientRect().right
    );
  });

  expect(chipWidth).toBeLessThan(gridTrackWidth);
  await expect(providerError).toHaveCSS("justify-self", "start");
});

test("shows the project and author footer links", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("link", { name: "OpenCandle" })).toHaveAttribute(
    "href",
    "https://github.com/kahtaf/OpenCandle",
  );
  await expect(page.getByRole("link", { name: "Kahtaf" })).toHaveAttribute(
    "href",
    "https://kahtaf.com",
  );
});

test("reports invalid ticker input without issuing a new preview request", async ({
  page,
}) => {
  await page.goto("/");
  const builder = page.locator("[data-request-builder]");
  const originalUrl = await builder
    .locator("[data-generated-url]")
    .textContent();

  await builder.getByLabel("Ticker").fill("bad ticker");
  await expect(builder.locator("[data-ticker-error]")).toHaveText(
    "Enter a valid market symbol.",
  );
  await expect(builder.locator("[data-generated-url]")).toHaveText(
    originalUrl ?? "",
  );
});

test("has no automatically detectable accessibility violations", async ({
  page,
}) => {
  await page.goto("/");
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test("serves a useful not-found page", async ({ page }) => {
  await page.goto("/does-not-exist");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "This line ends here.",
  );
  await expect(page.getByRole("link", { name: "Return home" })).toBeVisible();
});
