import { InvalidRequestError } from "../domain/errors";
import {
  COLORS,
  DEFAULT_SPARKLINE_OPTIONS,
  FORMATS,
  THEMES,
  type CanonicalSparklineRequest,
  type OutputFormat,
} from "../domain/request";
import { TIMEFRAMES } from "../domain/timeframe";

const ALLOWED_PARAMETERS = new Set([
  "ticker",
  "timeframe",
  "theme",
  "color",
  "format",
]);
const TICKER_PATTERN = /^[A-Za-z0-9.^=_-]+$/;
const MAX_TICKER_LENGTH = 32;
const MAX_URL_LENGTH = 2048;

function oneValue(url: URL, name: string): string | undefined {
  const values = url.searchParams.getAll(name);
  if (values.length > 1) {
    throw new InvalidRequestError(
      `Parameter '${name}' must be provided at most once.`,
    );
  }
  return values[0];
}

function enumValue<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  fallback: T,
  name: string,
): T {
  if (value === undefined) return fallback;
  if (!allowed.includes(value as T)) {
    throw new InvalidRequestError(
      `Parameter '${name}' has an unsupported value.`,
    );
  }
  return value as T;
}

export function requestedOutputMode(url: URL): OutputFormat | "invalid" {
  const values = url.searchParams.getAll("format");
  if (values.length === 0) return "svg";
  if (values.length !== 1) return "invalid";
  const value = values[0];
  return value !== undefined && FORMATS.includes(value as OutputFormat)
    ? (value as OutputFormat)
    : "invalid";
}

export function parseSparklineRequest(
  request: Request,
): CanonicalSparklineRequest {
  if (request.url.length > MAX_URL_LENGTH) {
    throw new InvalidRequestError("The request URL is too long.");
  }

  const url = new URL(request.url);
  for (const name of url.searchParams.keys()) {
    if (!ALLOWED_PARAMETERS.has(name)) {
      throw new InvalidRequestError(`Unknown parameter '${name}'.`);
    }
  }

  const tickerValue = oneValue(url, "ticker")?.trim();
  if (tickerValue === undefined || tickerValue.length === 0) {
    throw new InvalidRequestError("Parameter 'ticker' is required.");
  }
  if (
    tickerValue.length > MAX_TICKER_LENGTH ||
    !TICKER_PATTERN.test(tickerValue)
  ) {
    throw new InvalidRequestError(
      "Parameter 'ticker' contains unsupported characters.",
    );
  }

  const timeframe = enumValue(
    oneValue(url, "timeframe"),
    TIMEFRAMES,
    DEFAULT_SPARKLINE_OPTIONS.timeframe,
    "timeframe",
  );
  const theme = enumValue(
    oneValue(url, "theme"),
    THEMES,
    DEFAULT_SPARKLINE_OPTIONS.theme,
    "theme",
  );
  const rawColor = oneValue(url, "color");
  const color = enumValue(
    rawColor?.toLowerCase(),
    COLORS,
    DEFAULT_SPARKLINE_OPTIONS.color,
    "color",
  );
  const format = enumValue(
    oneValue(url, "format"),
    FORMATS,
    DEFAULT_SPARKLINE_OPTIONS.format,
    "format",
  );

  return {
    ticker: tickerValue.toUpperCase(),
    timeframe,
    theme,
    color,
    format,
  };
}
