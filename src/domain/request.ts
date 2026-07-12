import type { Timeframe } from "./timeframe";

export const THEMES = ["light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

export const COLORS = ["auto", "green", "red", "blue", "gray"] as const;
export type Color = (typeof COLORS)[number];

export const FORMATS = ["svg", "json"] as const;
export type OutputFormat = (typeof FORMATS)[number];

export type CanonicalSparklineRequest = Readonly<{
  ticker: string;
  timeframe: Timeframe;
  theme: Theme;
  color: Color;
  format: OutputFormat;
}>;

export const DEFAULT_SPARKLINE_OPTIONS = {
  timeframe: "1m",
  theme: "light",
  color: "auto",
  format: "svg",
} as const satisfies Omit<CanonicalSparklineRequest, "ticker">;

export function serializeCanonicalRequest(
  request: CanonicalSparklineRequest,
): string {
  const values = [
    ["ticker", request.ticker],
    ["timeframe", request.timeframe],
    ["theme", request.theme],
    ["color", request.color],
    ["format", request.format],
  ] as const;
  return values
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");
}
