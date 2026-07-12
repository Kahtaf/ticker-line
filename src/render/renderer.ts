import type { PublicErrorCode } from "../domain/errors";
import type { MarketPoint, MarketSeries } from "../domain/market-series";
import type { Theme } from "../domain/request";
import type { Timeframe } from "../domain/timeframe";
import {
  coordinatesToPath,
  createSparklineGeometry,
  formatCoordinate,
  type SparklineCoordinate,
} from "./path";
import { sampleMarketPoints } from "./sampling";
import {
  resolveBaselineColor,
  resolveToneColor,
  SVG_HEIGHT,
  SVG_PADDING_X,
  SVG_WIDTH,
  type ChartTone,
} from "./styles";

export type RenderOptions = Readonly<{
  width: 160;
  height: 48;
  theme: Theme;
  fill: boolean;
  ticker: string;
  timeframe: Timeframe;
}>;

type ToneRun = Readonly<{
  tone: ChartTone;
  points: readonly SparklineCoordinate[];
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

function toneForSide(side: number): ChartTone {
  return side < 0 ? "red" : "green";
}

function splitAtBaseline(
  coordinates: readonly SparklineCoordinate[],
  baselineClose: number,
  baselineY: number,
): readonly ToneRun[] {
  const runs: Array<{ tone: ChartTone; points: SparklineCoordinate[] }> = [];

  const addSegment = (
    tone: ChartTone,
    start: SparklineCoordinate,
    end: SparklineCoordinate,
  ): void => {
    const current = runs.at(-1);
    if (current?.tone === tone) {
      current.points.push(end);
      return;
    }
    runs.push({ tone, points: [start, end] });
  };

  for (let index = 1; index < coordinates.length; index += 1) {
    const start = coordinates[index - 1];
    const end = coordinates[index];
    if (start === undefined || end === undefined) continue;
    const startSide = Math.sign(start.close - baselineClose);
    const endSide = Math.sign(end.close - baselineClose);

    if (startSide !== 0 && endSide !== 0 && startSide !== endSide) {
      const scale = Math.max(
        Math.abs(start.close),
        Math.abs(end.close),
        Math.abs(baselineClose),
        Number.MIN_VALUE,
      );
      const startDistance = Math.abs(
        start.close / scale - baselineClose / scale,
      );
      const endDistance = Math.abs(end.close / scale - baselineClose / scale);
      const distance = startDistance + endDistance;
      const ratio = distance === 0 ? 0.5 : startDistance / distance;
      const crossing: SparklineCoordinate = {
        x: start.x + (end.x - start.x) * ratio,
        y: baselineY,
        close: baselineClose,
      };
      addSegment(toneForSide(startSide), start, crossing);
      addSegment(toneForSide(endSide), crossing, end);
      continue;
    }

    addSegment(toneForSide(startSide === 0 ? endSide : startSide), start, end);
  }

  return runs;
}

function createAreaPath(run: ToneRun, baselineY: number): string | undefined {
  if (run.points.every((point) => point.y === baselineY)) return undefined;
  const first = run.points[0];
  const last = run.points.at(-1);
  if (first === undefined || last === undefined) return undefined;
  const line = run.points
    .map(
      (point) => `L ${formatCoordinate(point.x)} ${formatCoordinate(point.y)}`,
    )
    .join(" ");
  return `M ${formatCoordinate(first.x)} ${formatCoordinate(baselineY)} ${line} L ${formatCoordinate(last.x)} ${formatCoordinate(baselineY)} Z`;
}

export function renderSparkline(
  points: readonly MarketPoint[],
  options: RenderOptions,
): string {
  if (options.width !== SVG_WIDTH || options.height !== SVG_HEIGHT) {
    throw new RangeError("Sparkline dimensions must be 160 by 48.");
  }
  const valid = acceptedPoints(points);
  if (valid.length === 0) {
    throw new RangeError("At least one finite market point is required.");
  }
  const sampled = sampleMarketPoints(valid);
  const first = sampled[0];
  const last = sampled.at(-1);
  if (first === undefined || last === undefined) {
    throw new RangeError("At least one finite market point is required.");
  }
  const title = escapeXmlText(
    `${options.ticker} ${options.timeframe} price sparkline`,
  );
  const description = escapeXmlText(
    `Price movement for ${options.ticker} over ${options.timeframe}, from ${first.close} to ${last.close}.`,
  );
  const geometry = createSparklineGeometry(sampled);
  const runs = splitAtBaseline(
    geometry.coordinates,
    geometry.baselineClose,
    geometry.baselineY,
  );
  const areas = options.fill
    ? runs
        .map((run) => {
          const path = createAreaPath(run, geometry.baselineY);
          return path === undefined
            ? ""
            : `<path d="${path}" fill="${resolveToneColor(options.theme, run.tone)}" fill-opacity="0.16" stroke="none"/>`;
        })
        .join("")
    : "";
  const baseline = `<path d="M ${SVG_PADDING_X} ${formatCoordinate(geometry.baselineY)} L ${SVG_WIDTH - SVG_PADDING_X} ${formatCoordinate(geometry.baselineY)}" fill="none" stroke="${resolveBaselineColor(options.theme)}" stroke-width="1" stroke-dasharray="2 3"/>`;
  const lines = runs
    .map(
      (run) =>
        `<path d="${coordinatesToPath(run.points)}" fill="none" stroke="${resolveToneColor(options.theme, run.tone)}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 48" width="160" height="48" role="img"><title>${title}</title><desc>${description}</desc>${areas}${baseline}${lines}</svg>`;
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
