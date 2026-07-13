export const INTERNAL_FRESH_UNTIL_HEADER = "X-Internal-Fresh-Until";
export const INTERNAL_CACHE_STATE_HEADER = "X-Internal-Cache-State";
export const INTERNAL_BROWSER_MAX_AGE_HEADER = "X-Internal-Browser-Max-Age";

const STABLE_HEADERS = [
  "cache-control",
  "content-type",
  "etag",
  "x-data-as-of",
  INTERNAL_FRESH_UNTIL_HEADER,
  INTERNAL_CACHE_STATE_HEADER,
  "x-error-code",
  "x-error-status",
] as const;

export type ResponseArtifactMetadata = Readonly<{
  freshUntil: Date;
  state: "FRESH" | "STALE" | "FALLBACK";
  cacheForSeconds?: number;
}>;

export interface ResponseCacheStore {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
  delete(request: Request): Promise<boolean>;
}

function browserMaxAge(cacheControl: string | null): string | undefined {
  return /(?:^|,\s*)max-age=(\d+)/.exec(cacheControl ?? "")?.[1];
}

/** Restore the application-selected browser TTL after Cache API/zone rules. */
export function restoreCachedBrowserMaxAge(headers: Headers): void {
  const original = headers.get(INTERNAL_BROWSER_MAX_AGE_HEADER);
  const cacheControl = headers.get("Cache-Control");
  if (original === null || !/^\d+$/.test(original) || cacheControl === null)
    return;
  const maxAge = /(?:^|,\s*)max-age=\d+/;
  headers.set(
    "Cache-Control",
    maxAge.test(cacheControl)
      ? cacheControl.replace(maxAge, (match) =>
          match.replace(/max-age=\d+/, `max-age=${original}`),
        )
      : `${cacheControl}, max-age=${original}`,
  );
}

export class ResponseArtifactCache {
  readonly #cache: ResponseCacheStore;

  constructor(cache: ResponseCacheStore) {
    this.#cache = cache;
  }

  async match(key: Request, now = new Date()): Promise<Response | undefined> {
    const response = await this.#cache.match(key);
    if (response === undefined) return undefined;
    const freshUntil = response.headers.get(INTERNAL_FRESH_UNTIL_HEADER);
    if (freshUntil === null || !Number.isFinite(Date.parse(freshUntil)))
      return undefined;
    if (now.getTime() >= Date.parse(freshUntil)) {
      await this.#cache.delete(key);
      return undefined;
    }
    return response;
  }

  async put(
    key: Request,
    response: Response,
    metadata: ResponseArtifactMetadata,
    now = new Date(),
  ): Promise<boolean> {
    const remainingSeconds = Math.max(
      0,
      Math.floor((metadata.freshUntil.getTime() - now.getTime()) / 1_000),
    );
    const cacheForSeconds = Math.min(
      remainingSeconds,
      metadata.cacheForSeconds ?? remainingSeconds,
    );
    if (cacheForSeconds <= 0) return false;

    const headers = new Headers();
    for (const name of STABLE_HEADERS) {
      const value = response.headers.get(name);
      if (value !== null) headers.set(name, value);
    }
    headers.set(INTERNAL_FRESH_UNTIL_HEADER, metadata.freshUntil.toISOString());
    headers.set(INTERNAL_CACHE_STATE_HEADER, metadata.state);
    if (!headers.has("Cache-Control")) {
      headers.set("Cache-Control", `public, max-age=${cacheForSeconds}`);
    }
    const selectedBrowserMaxAge = browserMaxAge(headers.get("Cache-Control"));
    if (selectedBrowserMaxAge !== undefined) {
      headers.set(INTERNAL_BROWSER_MAX_AGE_HEADER, selectedBrowserMaxAge);
    }
    const artifact = new Response(response.clone().body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
    await this.#cache.put(key, artifact);
    return true;
  }
}
