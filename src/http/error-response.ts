import type { OutputFormat } from "../domain/request";
import type { PublicError } from "../domain/errors";
import { createStrongEtag, renderErrorSparkline } from "../render/renderer";
import { JSON_CONTENT_TYPE, SVG_CONTENT_TYPE } from "./headers";

function fallbackCacheControl(error: PublicError): string {
  switch (error.code) {
    case "INVALID_REQUEST":
    case "TICKER_NOT_FOUND":
      return "public, max-age=60, s-maxage=300";
    case "INSUFFICIENT_DATA":
      return "public, max-age=60, s-maxage=600";
    case "RATE_LIMITED":
      return error.retryAfterSeconds === undefined
        ? "no-store"
        : `public, max-age=0, s-maxage=${error.retryAfterSeconds}`;
    case "PROVIDER_ERROR":
    case "SERVICE_UNAVAILABLE":
      return "public, max-age=0, s-maxage=60";
  }
}

export async function createErrorResponse(
  error: PublicError,
  mode: OutputFormat | "invalid",
  requestId: string,
): Promise<Response> {
  if (mode === "svg") {
    const body = renderErrorSparkline(error.code);
    const headers = new Headers({
      "Cache-Control": fallbackCacheControl(error),
      "Content-Type": SVG_CONTENT_TYPE,
      ETag: await createStrongEtag(body),
      "X-Cache": "MISS",
      "X-Error-Code": error.code,
      "X-Error-Status": String(error.status),
    });
    if (error.retryAfterSeconds !== undefined) {
      headers.set("Retry-After", String(error.retryAfterSeconds));
    }
    return new Response(body, { status: 200, headers });
  }

  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Type": JSON_CONTENT_TYPE,
  });
  if (error.retryAfterSeconds !== undefined) {
    headers.set("Retry-After", String(error.retryAfterSeconds));
  }

  return new Response(
    JSON.stringify({
      error: { code: error.code, message: error.message },
      requestId,
    }),
    { status: error.status, headers },
  );
}
