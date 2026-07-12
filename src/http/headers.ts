export const SVG_CONTENT_TYPE = "image/svg+xml; charset=utf-8";
export const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

const COMMON_API_HEADERS: Readonly<Record<string, string>> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Expose-Headers":
    "ETag, X-Cache, X-Data-As-Of, X-Error-Code, X-Error-Status, X-Request-Id",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

export function withApiHeaders(
  response: Response,
  requestId: string,
): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(COMMON_API_HEADERS)) {
    headers.set(name, value);
  }
  headers.set("X-Request-Id", requestId);

  if (headers.get("Content-Type")?.startsWith("image/svg+xml")) {
    headers.set(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    );
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function corsPreflightResponse(requestId: string): Response {
  return withApiHeaders(
    new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Headers": "Content-Type, If-None-Match",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Max-Age": "86400",
      },
    }),
    requestId,
  );
}

export function withoutBody(response: Response): Response {
  return new Response(null, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
