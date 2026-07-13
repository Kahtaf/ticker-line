import { afterEach, describe, expect, it, vi } from "vitest";
import { errorLogFields, logger } from "../../src/telemetry/logger";

describe("structured logger", () => {
  afterEach(() => vi.restoreAllMocks());

  it("emits indexable objects at error severity", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    logger.error("request_failed", { requestId: "request-1", status: 502 });

    expect(consoleError).toHaveBeenCalledWith(
      expect.objectContaining({
        schemaVersion: "v1",
        level: "error",
        event: "request_failed",
        message: "request_failed",
        requestId: "request-1",
        status: 502,
      }),
    );
  });

  it("captures bounded error and cause details", () => {
    const cause = new DOMException("Timed out", "TimeoutError");
    const error = new Error("Provider request failed", { cause });
    error.name = "ProviderTimeoutError";

    expect(errorLogFields(error)).toEqual({
      errorType: "ProviderTimeoutError",
      errorMessage: "Provider request failed",
      causeType: "TimeoutError",
      causeMessage: "Timed out",
    });
  });
});
