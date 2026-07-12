import { describe, expect, it } from "vitest";
import {
  INTERNAL_CACHE_STATE_HEADER,
  ResponseArtifactCache,
  type ResponseCacheStore,
} from "../../src/cache/response-cache";

class MemoryResponseCache implements ResponseCacheStore {
  readonly values = new Map<string, Response>();
  deleteCalls = 0;

  async match(request: Request): Promise<Response | undefined> {
    return this.values.get(request.url)?.clone();
  }

  async put(request: Request, response: Response): Promise<void> {
    this.values.set(request.url, response.clone());
  }

  async delete(request: Request): Promise<boolean> {
    this.deleteCalls += 1;
    return this.values.delete(request.url);
  }
}

describe("ResponseArtifactCache", () => {
  it("stores only stable representation metadata", async () => {
    const store = new MemoryResponseCache();
    const cache = new ResponseArtifactCache(store);
    const key = new Request("https://cache.internal/render/v1/v1?ticker=AAPL");
    const now = new Date("2026-07-12T12:00:00.000Z");
    const sourceResponse = new Response("<svg/>", {
      headers: {
        "Content-Type": "image/svg+xml",
        ETag: '"abc"',
        "X-Data-As-Of": "2026-07-11T20:00:00.000Z",
        "X-Request-Id": "must-not-be-stored",
        "X-Cache": "MISS",
      },
    });
    await cache.put(
      key,
      sourceResponse,
      { freshUntil: new Date(now.getTime() + 90_000), state: "FRESH" },
      now,
    );
    expect(await sourceResponse.text()).toBe("<svg/>");
    const stored = await cache.match(key, now);
    expect(await stored?.text()).toBe("<svg/>");
    expect(stored?.headers.get("X-Request-Id")).toBeNull();
    expect(stored?.headers.get("X-Cache")).toBeNull();
    expect(stored?.headers.get(INTERNAL_CACHE_STATE_HEADER)).toBe("FRESH");
    expect(stored?.headers.get("Cache-Control")).toBe("public, max-age=90");
  });

  it("rejects and removes logically expired artifacts", async () => {
    const store = new MemoryResponseCache();
    const cache = new ResponseArtifactCache(store);
    const key = new Request("https://cache.internal/expired");
    const now = new Date("2026-07-12T12:00:00.000Z");
    await cache.put(
      key,
      new Response("body"),
      { freshUntil: new Date(now.getTime() + 1_000), state: "STALE" },
      now,
    );
    expect(
      await cache.match(key, new Date(now.getTime() + 1_000)),
    ).toBeUndefined();
    expect(store.deleteCalls).toBe(1);
  });

  it("preserves the public browser and shared-cache directives", async () => {
    const store = new MemoryResponseCache();
    const cache = new ResponseArtifactCache(store);
    const key = new Request("https://cache.internal/directives");
    const now = new Date("2026-07-12T12:00:00.000Z");
    const cacheControl =
      "public, max-age=60, s-maxage=600, stale-while-revalidate=3600";
    await cache.put(
      key,
      new Response("body", { headers: { "Cache-Control": cacheControl } }),
      { freshUntil: new Date(now.getTime() + 600_000), state: "FRESH" },
      now,
    );
    expect((await cache.match(key, now))?.headers.get("Cache-Control")).toBe(
      cacheControl,
    );
  });
});
