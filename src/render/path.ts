import type { MarketPoint } from "../domain/market-series";
import { SVG_HEIGHT, SVG_PADDING_X, SVG_PADDING_Y, SVG_WIDTH } from "./styles";

export type SparklineCoordinate = Readonly<{
  x: number;
  y: number;
  close: number;
}>;

export type SparklineGeometry = Readonly<{
  baselineClose: number;
  baselineY: number;
  coordinates: readonly SparklineCoordinate[];
}>;

export function formatCoordinate(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

export function coordinatesToPath(
  coordinates: readonly Pick<SparklineCoordinate, "x" | "y">[],
): string {
  return coordinates
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"} ${formatCoordinate(point.x)} ${formatCoordinate(point.y)}`,
    )
    .join(" ");
}

export function createSparklineGeometry(
  points: readonly MarketPoint[],
  referenceClose?: number,
): SparklineGeometry {
  if (points.length === 0) {
    throw new RangeError("At least one point is required.");
  }
  const first = points[0];
  if (first === undefined) {
    throw new RangeError("At least one point is required.");
  }
  const baselineClose = referenceClose ?? first.close;
  if (!Number.isFinite(baselineClose)) {
    throw new RangeError("The reference close must be finite.");
  }
  if (points.length === 1) {
    const minClose = Math.min(first.close, baselineClose);
    const maxClose = Math.max(first.close, baselineClose);
    const toY = (close: number): number =>
      minClose === maxClose
        ? SVG_HEIGHT / 2
        : SVG_PADDING_Y +
          ((maxClose - close) / (maxClose - minClose)) *
            (SVG_HEIGHT - SVG_PADDING_Y * 2);
    const y = toY(first.close);
    return {
      baselineClose,
      baselineY: toY(baselineClose),
      coordinates: [
        { x: SVG_WIDTH / 2 - 3, y, close: first.close },
        { x: SVG_WIDTH / 2 + 3, y, close: first.close },
      ],
    };
  }

  const last = points.at(-1);
  if (last === undefined) {
    throw new RangeError("At least one point is required.");
  }
  const minTime = first.timestamp;
  const maxTime = last.timestamp;
  const timeExtent = maxTime - minTime;
  let minClose = baselineClose;
  let maxClose = baselineClose;
  for (const point of points) {
    minClose = Math.min(minClose, point.close);
    maxClose = Math.max(maxClose, point.close);
  }
  const closeExtent = maxClose - minClose;
  const closeScale = Math.max(Math.abs(minClose), Math.abs(maxClose), 1);
  const scaledMinClose = minClose / closeScale;
  const scaledMaxClose = maxClose / closeScale;
  const scaledCloseExtent = scaledMaxClose - scaledMinClose;
  const drawableWidth = SVG_WIDTH - SVG_PADDING_X * 2;
  const drawableHeight = SVG_HEIGHT - SVG_PADDING_Y * 2;

  const coordinates = points.map((point, index): SparklineCoordinate => {
    const x =
      timeExtent === 0
        ? SVG_PADDING_X + (index / (points.length - 1)) * drawableWidth
        : SVG_PADDING_X +
          ((point.timestamp - minTime) / timeExtent) * drawableWidth;
    const y =
      minClose === maxClose
        ? SVG_HEIGHT / 2
        : SVG_PADDING_Y +
          (Number.isFinite(closeExtent)
            ? (maxClose - point.close) / closeExtent
            : (scaledMaxClose - point.close / closeScale) / scaledCloseExtent) *
            drawableHeight;
    return { x, y, close: point.close };
  });

  return {
    baselineClose,
    baselineY:
      minClose === maxClose
        ? SVG_HEIGHT / 2
        : SVG_PADDING_Y +
          (Number.isFinite(closeExtent)
            ? (maxClose - baselineClose) / closeExtent
            : (scaledMaxClose - baselineClose / closeScale) /
              scaledCloseExtent) *
            drawableHeight,
    coordinates,
  };
}

export function createSparklinePath(points: readonly MarketPoint[]): string {
  return coordinatesToPath(createSparklineGeometry(points).coordinates);
}
