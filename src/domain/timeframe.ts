export const TIMEFRAMES = ["1d", "7d", "1m", "3m", "1y", "5y"] as const;

export type Timeframe = (typeof TIMEFRAMES)[number];

export const SOURCE_INTERVALS = ["15m", "1h", "1d", "1w"] as const;

export type SourceInterval = (typeof SOURCE_INTERVALS)[number];

export type TimeframePolicy = Readonly<{
  interval: SourceInterval;
  targetPoints: number;
}>;

const POLICIES: Readonly<Record<Timeframe, TimeframePolicy>> = {
  "1d": { interval: "15m", targetPoints: 128 },
  "7d": { interval: "1h", targetPoints: 168 },
  "1m": { interval: "1d", targetPoints: 31 },
  "3m": { interval: "1d", targetPoints: 92 },
  "1y": { interval: "1d", targetPoints: 250 },
  "5y": { interval: "1w", targetPoints: 250 },
};

export function getTimeframePolicy(timeframe: Timeframe): TimeframePolicy {
  return POLICIES[timeframe];
}

export function getTimeframeRange(
  timeframe: Timeframe,
  end: Date,
): Readonly<{ start: Date; end: Date }> {
  const endTime = end.getTime();
  if (!Number.isFinite(endTime))
    throw new TypeError("Range end must be a valid date.");

  const start = new Date(endTime);
  const subtractMonths = (months: number): void => {
    const day = start.getUTCDate();
    start.setUTCDate(1);
    start.setUTCMonth(start.getUTCMonth() - months);
    const lastDay = new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0),
    ).getUTCDate();
    start.setUTCDate(Math.min(day, lastDay));
  };
  const subtractYears = (years: number): void => {
    const month = start.getUTCMonth();
    const day = start.getUTCDate();
    start.setUTCDate(1);
    start.setUTCFullYear(start.getUTCFullYear() - years);
    start.setUTCMonth(month);
    const lastDay = new Date(
      Date.UTC(start.getUTCFullYear(), month + 1, 0),
    ).getUTCDate();
    start.setUTCDate(Math.min(day, lastDay));
  };
  switch (timeframe) {
    case "1d":
      start.setUTCDate(start.getUTCDate() - 1);
      break;
    case "7d":
      start.setUTCDate(start.getUTCDate() - 7);
      break;
    case "1m":
      subtractMonths(1);
      break;
    case "3m":
      subtractMonths(3);
      break;
    case "1y":
      subtractYears(1);
      break;
    case "5y":
      subtractYears(5);
      break;
  }

  return { start, end: new Date(endTime) };
}
