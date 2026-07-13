import { describe, expect, it, vi } from "vitest";
import { RateLimitedError } from "../../src/domain/errors";
import { enforceClientRateLimit } from "../../src/http/client-rate-limit";

function limiter(success: boolean): Readonly<{
  binding: RateLimit;
  limit: ReturnType<typeof vi.fn>;
}> {
  const limit = vi.fn((_options: { key: string }) =>
    Promise.resolve({ success }),
  );
  return { binding: { limit }, limit };
}

describe("enforceClientRateLimit", () => {
  it("allows requests accepted by both windows", async () => {
    const burst = limiter(true);
    const sustained = limiter(true);

    await expect(
      enforceClientRateLimit(burst.binding, sustained.binding, "client-ip"),
    ).resolves.toBeUndefined();
    expect(burst.limit).toHaveBeenCalledWith({ key: "client-ip" });
    expect(sustained.limit).toHaveBeenCalledWith({ key: "client-ip" });
  });

  it("rejects burst traffic without consuming the sustained window", async () => {
    const burst = limiter(false);
    const sustained = limiter(true);

    const error = await enforceClientRateLimit(
      burst.binding,
      sustained.binding,
      "client-ip",
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RateLimitedError);
    expect((error as RateLimitedError).retryAfterSeconds).toBe(10);
    expect(sustained.limit).not.toHaveBeenCalled();
  });

  it("rejects sustained traffic with a one-minute retry hint", async () => {
    const burst = limiter(true);
    const sustained = limiter(false);

    const error = await enforceClientRateLimit(
      burst.binding,
      sustained.binding,
      "client-ip",
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RateLimitedError);
    expect((error as RateLimitedError).retryAfterSeconds).toBe(60);
  });
});
