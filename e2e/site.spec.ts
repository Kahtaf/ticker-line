import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const validSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 48" width="160" height="48"><title>Test chart</title><path d="M2 40L42 30L82 34L122 12L158 8" fill="none" stroke="#236b43" stroke-width="2"/></svg>`;

test.beforeEach(async ({ page }) => {
  await page.route("**/v1/sparkline?*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/svg+xml; charset=utf-8",
      body: validSvg,
    }),
  );
});

test("renders indexable documentation and a live product example", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page).toHaveTitle(/Ticker Line/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Market sparklines in one URL.",
  );
  await expect(page.getByRole("heading", { name: "Parameters" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Errors" })).toBeVisible();
  await expect(
    page.locator('img[alt="AAPL price over one month"]'),
  ).toBeVisible();
});

test("loads common ticker presets into the live builder", async ({ page }) => {
  await page.goto("/");
  const builder = page.locator("[data-request-builder]");

  await builder.getByRole("link", { name: "BTC-USD" }).click();

  await expect(builder.getByLabel("Ticker")).toHaveValue("BTC-USD");
  await expect(builder.locator("[data-generated-url]")).toContainText(
    "ticker=BTC-USD",
  );
  await expect(builder.locator("[data-generated-url]")).toHaveAttribute(
    "href",
    /ticker=BTC-USD/,
  );
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
  await expect(builder.locator("[data-preview-status]")).toHaveText(
    "Live preview",
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
