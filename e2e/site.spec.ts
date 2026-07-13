import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const validSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 48" width="160" height="48"><title>Test chart</title><path d="M2 40L42 30L82 34L122 12L158 8" fill="none" stroke="#236b43" stroke-width="2"/></svg>`;

test.beforeEach(async ({ page }) => {
  await page.route("**/v1/sparkline?*", (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.searchParams.get("format") === "json") {
      const ticker = requestUrl.searchParams.get("ticker") ?? "AAPL";
      const isDown = ticker === "USD/CAD";
      return route.fulfill({
        status: 200,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify({
          ticker,
          timeframe: "1d",
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
    "Render market sparklines through a URL",
  );
  await expect(page.getByText("Public API · v1")).toHaveCount(0);
  await expect(page.getByText("Live preview")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Parameters" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Errors" })).toBeVisible();
  await expect(page.getByText('"referencePrice": 296.34')).toBeVisible();
  await expect(
    page.getByText("changePercent is expressed in percentage points."),
  ).toBeVisible();
  await expect(
    page.locator('img[alt="AAPL price over one month"]'),
  ).toBeVisible();
});

test("loads common ticker presets into the live builder", async ({ page }) => {
  await page.goto("/");
  const builder = page.locator("[data-request-builder]");

  await builder.getByRole("link", { name: "NAS100-USD" }).click();

  await expect(builder.getByLabel("Ticker")).toHaveValue("NAS100-USD");
  await expect(builder.locator("[data-generated-url]")).toContainText(
    "https://ticker-line.com/v1/sparkline?ticker=NAS100-USD",
  );
  await expect(builder.locator("[data-generated-url]")).toHaveAttribute(
    "href",
    /ticker=NAS100-USD/,
  );
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

  await builder.getByLabel("Ticker").fill("btc-usd");
  await builder.getByLabel("Timeframe").selectOption("7d");
  await builder.getByLabel("Theme").selectOption("dark");
  await builder.getByLabel("Fill").selectOption("true");

  await expect(builder.locator("[data-generated-url]")).toContainText(
    "ticker=BTC-USD",
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
    "BTC-USD price over seven days",
  );
  await expect(builder.locator("[data-generated-url]")).toHaveText(
    /^https:\/\/ticker-line\.com\/v1\/sparkline\?/,
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
  await expect(
    page.getByRole("link", { name: "London Strategic Edge" }),
  ).toHaveAttribute("href", "https://londonstrategicedge.com/data#overview");
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
