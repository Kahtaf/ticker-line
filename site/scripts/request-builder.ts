const TIMEFRAME_LABELS: Record<string, string> = {
  "1d": "one day",
  "7d": "seven days",
  "1m": "one month",
  "3m": "three months",
  "1y": "one year",
  "5y": "five years",
};

const TICKER_PATTERN = /^[A-Z0-9.^=_-]{1,32}$/;

function copyText(
  text: string,
  button: HTMLButtonElement,
  status?: HTMLElement | null,
) {
  const original = button.textContent ?? "Copy";

  navigator.clipboard.writeText(text).then(
    () => {
      button.textContent = "Copied";
      if (status)
        status.textContent = `${original.replace("Copy ", "")} copied to clipboard.`;
      window.setTimeout(() => {
        button.textContent = original;
        if (status) status.textContent = "";
      }, 1800);
    },
    () => {
      if (status)
        status.textContent =
          "Copy failed. Select the text and copy it manually.";
    },
  );
}

document.querySelectorAll<HTMLElement>("[data-copy-group]").forEach((group) => {
  const tabs = [
    ...group.querySelectorAll<HTMLButtonElement>("[data-example-tab]"),
  ];
  const panels = [
    ...group.querySelectorAll<HTMLElement>("[data-example-panel]"),
  ];

  function activate(tab: HTMLButtonElement) {
    const target = tab.dataset.exampleTab;
    tabs.forEach((item) => {
      const selected = item === tab;
      item.setAttribute("aria-selected", String(selected));
      item.tabIndex = selected ? 0 : -1;
    });
    panels.forEach((panel) => {
      panel.hidden = panel.dataset.examplePanel !== target;
    });
    tab.focus();
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => activate(tab));
    tab.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const offset = event.key === "ArrowRight" ? 1 : -1;
      const nextTab = tabs[(index + offset + tabs.length) % tabs.length];
      if (nextTab) activate(nextTab);
    });
  });
});

document
  .querySelectorAll<HTMLButtonElement>("[data-copy]")
  .forEach((button) => {
    button.addEventListener("click", () => {
      const status = button
        .closest("[data-copy-group]")
        ?.querySelector<HTMLElement>(".copy-status");
      copyText(button.dataset.copy ?? "", button, status);
    });
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
  const status = form.querySelector<HTMLElement>("[data-preview-status]");
  const generated = form.querySelector<HTMLElement>("[data-generated-url]");
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
      if (tickerError)
        tickerError.textContent =
          "Enter a valid market symbol before loading a preview.";
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
    const nextUrl = `/v1/sparkline?${params.toString()}`;

    if (generated) generated.textContent = nextUrl;
    if (frame) frame.dataset.previewState = "loading";
    if (status) status.textContent = "Loading preview";
    if (image) {
      image.alt = `${ticker} price over ${TIMEFRAME_LABELS[timeframeInput.value]}`;
      image.src = nextUrl;
    }
  };

  form.addEventListener("input", () => {
    window.clearTimeout(debounce);
    debounce = window.setTimeout(update, 350);
  });

  image?.addEventListener("load", () => {
    if (frame) frame.dataset.previewState = "ready";
    if (status) status.textContent = "Live preview";
  });

  image?.addEventListener("error", () => {
    if (frame) frame.dataset.previewState = "error";
    if (status) status.textContent = "Preview unavailable";
  });

  copyButton?.addEventListener("click", () => {
    copyText(generated?.textContent ?? "", copyButton, status);
  });
}
