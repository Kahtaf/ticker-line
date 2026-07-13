const TIMEFRAME_LABELS: Record<string, string> = {
  "1d": "one day",
  "7d": "seven days",
  "1m": "one month",
  "3m": "three months",
  "1y": "one year",
  "5y": "five years",
};

const PUBLIC_API_ORIGIN = "https://ticker-line.com";
const TICKER_PATTERN = /^[A-Z0-9./^=_-]{1,32}$/;

type MarketDirection = "up" | "down" | "flat";
type MarketQuote = Readonly<{
  price: number;
  change: number;
  changePercent: number | null;
  direction: MarketDirection;
  svg: string;
}>;

const marketCards = [
  ...document.querySelectorAll<HTMLButtonElement>("[data-market-card]"),
];
const liveUrl = document.querySelector<HTMLElement>("[data-live-url]");
const liveUrlCopy = document.querySelector<HTMLButtonElement>(
  "[data-copy-live-url]",
);
const priceFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});
let marketLoadVersion = 0;

function resolvedSiteTheme(): "light" | "dark" {
  const explicit = document.documentElement.dataset.theme;
  if (explicit === "light" || explicit === "dark") return explicit;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function formatSigned(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${priceFormatter.format(Math.abs(value))}`;
}

function isMarketQuote(value: unknown): value is MarketQuote {
  if (typeof value !== "object" || value === null) return false;
  const quote = value as Partial<MarketQuote>;
  return (
    typeof quote.price === "number" &&
    Number.isFinite(quote.price) &&
    typeof quote.change === "number" &&
    Number.isFinite(quote.change) &&
    (quote.changePercent === null ||
      (typeof quote.changePercent === "number" &&
        Number.isFinite(quote.changePercent))) &&
    (quote.direction === "up" ||
      quote.direction === "down" ||
      quote.direction === "flat") &&
    typeof quote.svg === "string"
  );
}

function svgElement(source: string): SVGSVGElement | undefined {
  const parsed = new DOMParser().parseFromString(source, "image/svg+xml");
  const root = parsed.documentElement;
  if (
    root.localName !== "svg" ||
    root.namespaceURI !== "http://www.w3.org/2000/svg"
  )
    return undefined;
  return document.importNode(root, true) as unknown as SVGSVGElement;
}

function updateLiveUrl(ticker: string, timeframe: string): void {
  const params = new URLSearchParams({ ticker, timeframe });
  const nextUrl = new URL(
    `/v1/sparkline?${params.toString()}`,
    PUBLIC_API_ORIGIN,
  ).href;
  if (liveUrl) liveUrl.textContent = nextUrl;
  if (liveUrlCopy) liveUrlCopy.dataset.copy = nextUrl;
}

function selectMarketCard(ticker: string, timeframe: string): void {
  for (const card of marketCards) {
    card.setAttribute(
      "aria-pressed",
      String(timeframe === "1d" && card.dataset.ticker === ticker),
    );
  }
}

async function loadMarketCard(
  card: HTMLButtonElement,
  theme: "light" | "dark",
  version: number,
  attempt = 0,
): Promise<void> {
  const ticker = card.dataset.ticker;
  if (ticker === undefined) return;
  card.dataset.marketState = "loading";
  const params = new URLSearchParams({
    ticker,
    timeframe: "1d",
    theme,
    fill: "true",
    format: "json",
  });
  try {
    const response = await fetch(`/v1/sparkline?${params.toString()}`);
    if (response.status === 429 && attempt === 0) {
      await new Promise((resolve) => window.setTimeout(resolve, 1200));
      if (version === marketLoadVersion) {
        return loadMarketCard(card, theme, version, attempt + 1);
      }
      return;
    }
    if (!response.ok)
      throw new Error(`Quote request failed: ${response.status}`);
    const payload: unknown = await response.json();
    if (!isMarketQuote(payload)) throw new Error("Invalid quote response");
    if (version !== marketLoadVersion) return;

    const price = card.querySelector<HTMLElement>("[data-market-price]");
    const change = card.querySelector<HTMLElement>("[data-market-change]");
    const performance = card.querySelector<HTMLElement>(
      "[data-market-performance]",
    );
    const percent = card.querySelector<HTMLElement>("[data-market-percent]");
    const direction = card.querySelector<HTMLElement>(".market-direction");
    const chart = card.querySelector<HTMLElement>("[data-market-chart]");
    if (price) price.textContent = priceFormatter.format(payload.price);
    if (change) change.textContent = `(${formatSigned(payload.change)})`;
    if (performance) performance.dataset.direction = payload.direction;
    if (percent) {
      percent.textContent =
        payload.changePercent === null
          ? "—"
          : `${formatSigned(payload.changePercent)}%`;
    }
    if (direction) {
      direction.textContent =
        payload.direction === "up"
          ? "↑"
          : payload.direction === "down"
            ? "↓"
            : "–";
    }
    const svg = svgElement(payload.svg);
    if (chart && svg) chart.replaceChildren(svg);
    card.dataset.marketState = "ready";
  } catch {
    if (version === marketLoadVersion) card.dataset.marketState = "error";
  }
}

function loadMarketCards(): void {
  marketLoadVersion += 1;
  const version = marketLoadVersion;
  const theme = resolvedSiteTheme();
  for (const [index, card] of marketCards.entries()) {
    window.setTimeout(() => {
      if (version === marketLoadVersion) {
        void loadMarketCard(card, theme, version);
      }
    }, index * 300);
  }
}

for (const card of marketCards) {
  card.addEventListener("click", () => {
    const ticker = card.dataset.ticker;
    if (ticker === undefined) return;
    updateLiveUrl(ticker, "1d");
    selectMarketCard(ticker, "1d");
    document.dispatchEvent(
      new CustomEvent("ticker-line:select-sample", {
        detail: { ticker, timeframe: "1d" },
      }),
    );
  });
}

loadMarketCards();

function copyText(text: string, button: HTMLButtonElement) {
  const original = button.textContent ?? "Copy";
  navigator.clipboard.writeText(text).then(
    () => {
      button.textContent = "Copied";
      window.setTimeout(() => (button.textContent = original), 1600);
    },
    () => (button.textContent = "Select and copy"),
  );
}

document
  .querySelectorAll<HTMLButtonElement>("[data-copy]")
  .forEach((button) => {
    button.addEventListener("click", () =>
      copyText(button.dataset.copy ?? "", button),
    );
  });

const themeToggle = document.querySelector<HTMLButtonElement>(
  "[data-theme-toggle]",
);

themeToggle?.addEventListener("click", () => {
  const current = document.documentElement.dataset.theme;
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const next = current
    ? current === "dark"
      ? "light"
      : "dark"
    : systemDark
      ? "light"
      : "dark";
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem("ticker-line-theme", next);
  } catch {
    // The visual preference still applies when storage is unavailable.
  }
  loadMarketCards();
});

const form = document.querySelector<HTMLFormElement>("[data-request-builder]");

if (form) {
  const tickerInput = form.querySelector(
    '[name="ticker"]',
  ) as unknown as HTMLInputElement | null;
  const timeframeInput = form.querySelector(
    '[name="timeframe"]',
  ) as unknown as HTMLSelectElement | null;
  const themeInput = form.querySelector(
    '[name="theme"]',
  ) as unknown as HTMLSelectElement | null;
  const fillInput = form.querySelector(
    '[name="fill"]',
  ) as unknown as HTMLSelectElement | null;
  const image = form.querySelector<HTMLImageElement>("[data-preview-image]");
  const frame = form.querySelector<HTMLElement>(".preview-frame");
  const generated = form.querySelector<HTMLAnchorElement>(
    "[data-generated-url]",
  );
  const tickerError = form.querySelector<HTMLElement>("[data-ticker-error]");
  const copyButton = form.querySelector<HTMLButtonElement>(
    "[data-copy-generated]",
  );
  let debounce: number | undefined;

  const update = () => {
    if (!tickerInput || !timeframeInput || !themeInput || !fillInput) return;
    const ticker = tickerInput.value.trim().toUpperCase();
    tickerInput.value = ticker;

    if (!TICKER_PATTERN.test(ticker)) {
      tickerInput.setAttribute("aria-invalid", "true");
      if (tickerError) tickerError.textContent = "Enter a valid market symbol.";
      return;
    }

    tickerInput.removeAttribute("aria-invalid");
    if (tickerError) tickerError.textContent = "";

    const params = new URLSearchParams({
      ticker,
      timeframe: timeframeInput.value,
      theme: themeInput.value,
      fill: fillInput.value,
    });
    const nextPath = `/v1/sparkline?${params.toString()}`;
    const nextUrl = new URL(nextPath, PUBLIC_API_ORIGIN).href;

    updateLiveUrl(ticker, timeframeInput.value);
    selectMarketCard(ticker, timeframeInput.value);

    if (generated) {
      generated.textContent = nextUrl;
      generated.href = nextUrl;
    }
    if (frame) frame.dataset.previewState = "loading";
    if (image) {
      image.alt = `${ticker} price over ${TIMEFRAME_LABELS[timeframeInput.value]}`;
      image.src = nextPath;
    }
  };

  form.addEventListener("input", () => {
    window.clearTimeout(debounce);
    debounce = window.setTimeout(update, 250);
  });

  form
    .querySelectorAll<HTMLAnchorElement>("[data-ticker-preset]")
    .forEach((link) => {
      link.addEventListener("click", (event) => {
        event.preventDefault();
        if (!tickerInput) return;
        tickerInput.value = link.dataset.tickerPreset ?? "";
        update();
        tickerInput.focus();
      });
    });

  document.addEventListener("ticker-line:select-sample", (event) => {
    const detail = (event as CustomEvent<{ ticker: string; timeframe: string }>)
      .detail;
    if (!tickerInput || !timeframeInput || detail === undefined) return;
    tickerInput.value = detail.ticker;
    timeframeInput.value = detail.timeframe;
    update();
  });

  image?.addEventListener("load", () => {
    if (frame) frame.dataset.previewState = "ready";
  });

  image?.addEventListener("error", () => {
    if (frame) frame.dataset.previewState = "error";
  });

  copyButton?.addEventListener("click", () =>
    copyText(generated?.textContent ?? "", copyButton),
  );
}
