import { RateLimitedError } from "../domain/errors";

const BURST_RETRY_AFTER_SECONDS = 10;
const SUSTAINED_RETRY_AFTER_SECONDS = 60;

export async function enforceClientRateLimit(
  burstLimiter: RateLimit,
  sustainedLimiter: RateLimit,
  key: string,
): Promise<void> {
  const burst = await burstLimiter.limit({ key });
  if (!burst.success) {
    throw new RateLimitedError(undefined, {
      retryAfterSeconds: BURST_RETRY_AFTER_SECONDS,
    });
  }

  const sustained = await sustainedLimiter.limit({ key });
  if (!sustained.success) {
    throw new RateLimitedError(undefined, {
      retryAfterSeconds: SUSTAINED_RETRY_AFTER_SECONDS,
    });
  }
}
