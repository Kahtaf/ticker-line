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
