import type { Timeframe } from "./timeframe";

export const THEMES = ["light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

export const FILLS = ["false", "true"] as const;
export type FillValue = (typeof FILLS)[number];

export const FORMATS = ["svg", "json"] as const;
export type OutputFormat = (typeof FORMATS)[number];

export type CanonicalSparklineRequest = Readonly<{
  ticker: string;
  timeframe: Timeframe;
  theme: Theme;
  fill: boolean;
  format: OutputFormat;
}>;

export const DEFAULT_SPARKLINE_OPTIONS = {
  timeframe: "1m",
  theme: "light",
  fill: false,
  format: "svg",
} as const satisfies Omit<CanonicalSparklineRequest, "ticker">;

export function serializeCanonicalRequest(
  request: CanonicalSparklineRequest,
): string {
  const values = [
    ["ticker", request.ticker],
    ["timeframe", request.timeframe],
    ["theme", request.theme],
    ["fill", String(request.fill)],
    ["format", request.format],
  ] as const;
  return values
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");
}
