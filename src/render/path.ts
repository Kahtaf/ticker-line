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
): SparklineGeometry {
  if (points.length === 0) {
    throw new RangeError("At least one point is required.");
  }
  const first = points[0];
  if (first === undefined) {
    throw new RangeError("At least one point is required.");
  }
  if (points.length === 1) {
    const y = SVG_HEIGHT / 2;
    return {
      baselineClose: first.close,
      baselineY: y,
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
  let minClose = Infinity;
  let maxClose = -Infinity;
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
    baselineClose: first.close,
    baselineY: coordinates[0]?.y ?? SVG_HEIGHT / 2,
    coordinates,
  };
}

export function createSparklinePath(points: readonly MarketPoint[]): string {
  return coordinatesToPath(createSparklineGeometry(points).coordinates);
}
