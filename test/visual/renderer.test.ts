import { Resvg } from "@resvg/resvg-js";
import { describe, expect, it } from "vitest";
import {
  renderErrorSparkline,
  renderSparkline,
} from "../../src/render/renderer";

describe("rasterized renderer output", () => {
  it("rasterizes a volatile chart at its intrinsic dimensions", () => {
    const svg = renderSparkline(
      [0, 100, -80, 120, -20].map((close, timestamp) => ({
        timestamp,
        close,
      })),
      {
        width: 160,
        height: 48,
        theme: "dark",
        fill: true,
        ticker: "TEST",
        timeframe: "1m",
      },
    );
    const rendered = new Resvg(svg).render();
    expect(rendered.width).toBe(160);
    expect(rendered.height).toBe(48);
    expect(rendered.asPng().byteLength).toBeGreaterThan(100);
  });

  it("rasterizes and preserves the longest fallback label", () => {
    const svg = renderErrorSparkline("SERVICE_UNAVAILABLE");
    const rendered = new Resvg(svg).render();
    expect(rendered.width).toBe(160);
    expect(rendered.height).toBe(48);
    expect(rendered.asPng().byteLength).toBeGreaterThan(300);
  });
});
