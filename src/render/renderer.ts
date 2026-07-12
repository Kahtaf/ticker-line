import type { MarketPoint, MarketSeries } from "../domain/market-series";
import type { Color, Theme } from "../domain/request";
import type { Timeframe } from "../domain/timeframe";
import type { PublicErrorCode } from "../domain/errors";
import { createSparklinePath } from "./path";
import { sampleMarketPoints } from "./sampling";
import { resolveStroke, SVG_HEIGHT, SVG_WIDTH } from "./styles";

export type RenderOptions = Readonly<{
  width: 160;
  height: 48;
  theme: Theme;
  color: Color;
  ticker: string;
  timeframe: Timeframe;
}>;

export function escapeXmlText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function acceptedPoints(
  points: readonly MarketPoint[],
): readonly MarketPoint[] {
  return points
    .filter(
      (point) =>
        Number.isFinite(point.timestamp) && Number.isFinite(point.close),
    )
    .map((point, index) => ({ point, index }))
    .sort((a, b) => a.point.timestamp - b.point.timestamp || a.index - b.index)
    .map(({ point }) => point);
}

export function renderSparkline(
  points: readonly MarketPoint[],
  options: RenderOptions,
): string {
  if (options.width !== SVG_WIDTH || options.height !== SVG_HEIGHT) {
    throw new RangeError("Sparkline dimensions must be 160 by 48.");
  }
  const valid = acceptedPoints(points);
  if (valid.length === 0)
    throw new RangeError("At least one finite market point is required.");
  const sampled = sampleMarketPoints(valid);
  const first = sampled[0];
  const last = sampled.at(-1);
  if (first === undefined || last === undefined)
    throw new RangeError("At least one finite market point is required.");
  const stroke = resolveStroke(
    options.theme,
    options.color,
    first.close,
    last.close,
  );
  const title = escapeXmlText(
    `${options.ticker} ${options.timeframe} price sparkline`,
  );
  const description = escapeXmlText(
    `Price movement for ${options.ticker} over ${options.timeframe}, from ${first.close} to ${last.close}.`,
  );
  const path = createSparklinePath(sampled);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 48" width="160" height="48" role="img"><title>${title}</title><desc>${description}</desc><path d="${path}" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

export function renderErrorSparkline(code: PublicErrorCode): string {
  const title = `Sparkline unavailable: ${code}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 48" width="160" height="48" role="img"><title>${title}</title><desc>This sparkline is temporarily unavailable. Use JSON format for error details.</desc><path d="M 4 15 L 21 11 L 38 17 L 55 9 L 72 15 L 89 12 L 106 18 L 123 10 L 140 14 L 156 11" fill="none" stroke="#8b9099" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><text x="80" y="38" fill="#6b7280" font-family="monospace" font-size="7" text-anchor="middle">${code}</text></svg>`;
}

export type SparklineJson = Readonly<{
  ticker: string;
  timeframe: Timeframe;
  currency?: string;
  dataAsOf: string;
  svg: string;
}>;

export function renderSparklineJson(
  series: Pick<MarketSeries, "currency" | "dataAsOf">,
  options: Pick<RenderOptions, "ticker" | "timeframe">,
  svg: string,
): string {
  const required = {
    ticker: options.ticker,
    timeframe: options.timeframe,
  };
  const body: SparklineJson =
    series.currency === undefined
      ? { ...required, dataAsOf: series.dataAsOf, svg }
      : {
          ...required,
          currency: series.currency,
          dataAsOf: series.dataAsOf,
          svg,
        };
  return JSON.stringify(body);
}

export async function createStrongEtag(body: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(body),
  );
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `"${hex}"`;
}
