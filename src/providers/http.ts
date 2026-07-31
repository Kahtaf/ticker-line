import { ProviderSchemaError } from "../domain/errors";
import { PROVIDER_RESPONSE_MAX_BYTES } from "./provider";

export async function readBoundedBody(
  response: Response,
  maximumBytes = PROVIDER_RESPONSE_MAX_BYTES,
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new TypeError("maximumBytes must be a positive safe integer.");
  }
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && Number(declaredLength) > maximumBytes) {
    await response.body?.cancel();
    throw new ProviderSchemaError(
      "Provider response exceeded the configured byte limit.",
    );
  }
  if (response.body === null) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      length += result.value.byteLength;
      if (length > maximumBytes) {
        await reader.cancel("response too large");
        throw new ProviderSchemaError(
          "Provider response exceeded the configured byte limit.",
        );
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export function parseRetryAfter(
  value: string | null,
  now = Date.now(),
): number | undefined {
  if (value === null) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return undefined;
  return Math.max(0, Math.ceil((date - now) / 1_000));
}
