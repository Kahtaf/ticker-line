import type { AssetType } from "../domain/market-series";
import type { Timeframe } from "../domain/timeframe";

export type FreshnessInput = Readonly<{
  timeframe: Timeframe;
  assetType: AssetType;
  marketState?: "active" | "closed" | "unknown";
  nextMeaningfulUpdate?: Date;
  now?: Date;
}>;

export type FreshnessDecision = Readonly<{
  freshForSeconds: number;
  staleForSeconds: number;
  browserMaxAgeSeconds: number;
  retryBackoffSeconds: number;
  reason: string;
}>;

export interface FreshnessPolicy {
  evaluate(input: FreshnessInput): FreshnessDecision;
}

const ACTIVE_POLICY: Readonly<
  Record<
    Timeframe,
    Readonly<{ freshForSeconds: number; staleForSeconds: number }>
  >
> = {
  "1d": { freshForSeconds: 1_500, staleForSeconds: 3_600 },
  "7d": { freshForSeconds: 6_000, staleForSeconds: 21_600 },
  "1m": { freshForSeconds: 18_000, staleForSeconds: 86_400 },
  "3m": { freshForSeconds: 36_000, staleForSeconds: 86_400 },
  "1y": { freshForSeconds: 72_000, staleForSeconds: 259_200 },
  "5y": { freshForSeconds: 432_000, staleForSeconds: 604_800 },
};

export const defaultFreshnessPolicy: FreshnessPolicy = {
  evaluate(input): FreshnessDecision {
    const configured = ACTIVE_POLICY[input.timeframe];
    let freshForSeconds = configured.freshForSeconds;
    let reason = `${input.timeframe}-fixed-active-policy`;

    if (
      input.assetType !== "crypto" &&
      input.marketState === "closed" &&
      input.nextMeaningfulUpdate !== undefined
    ) {
      const now = input.now ?? new Date();
      const untilUpdate = Math.ceil(
        (input.nextMeaningfulUpdate.getTime() - now.getTime()) / 1_000,
      );
      if (Number.isFinite(untilUpdate) && untilUpdate > freshForSeconds) {
        freshForSeconds = untilUpdate + 60;
        reason = `${input.timeframe}-trusted-next-market-update`;
      }
    }

    return {
      freshForSeconds,
      staleForSeconds: configured.staleForSeconds,
      browserMaxAgeSeconds: Math.min(60, freshForSeconds),
      retryBackoffSeconds: 60,
      reason,
    };
  },
};

export const NEGATIVE_CACHE_TTL_SECONDS = {
  not_found: 300,
  insufficient_data: 600,
} as const;
