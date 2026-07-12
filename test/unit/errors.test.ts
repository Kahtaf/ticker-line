import { describe, expect, it } from "vitest";
import {
  MethodNotAllowedError,
  ProviderNotFoundError,
  ProviderRateLimitError,
  ProviderSchemaError,
  toPublicError,
} from "../../src/domain/errors";

describe("public error mapping", () => {
  it("maps known errors without leaking provider details", () => {
    expect(toPublicError(new MethodNotAllowedError())).toMatchObject({
      code: "INVALID_REQUEST",
      status: 405,
    });
    expect(toPublicError(new ProviderNotFoundError())).toMatchObject({
      code: "TICKER_NOT_FOUND",
      status: 404,
    });
    expect(
      toPublicError(new ProviderSchemaError("secret upstream body")),
    ).toEqual({
      code: "PROVIDER_ERROR",
      status: 502,
      message: "The market data provider is temporarily unavailable.",
    });
  });

  it("preserves a bounded retry hint", () => {
    expect(
      toPublicError(
        new ProviderRateLimitError(undefined, { retryAfterSeconds: 12 }),
      ),
    ).toMatchObject({
      code: "RATE_LIMITED",
      status: 429,
      retryAfterSeconds: 12,
    });
  });

  it("maps unexpected values to service unavailable", () => {
    expect(toPublicError(new Error("internal secret"))).toEqual({
      code: "SERVICE_UNAVAILABLE",
      status: 503,
      message: "The service is temporarily unavailable.",
    });
  });
});
