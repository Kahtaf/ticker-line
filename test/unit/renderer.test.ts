import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { PUBLIC_ERROR_CODES } from "../../src/domain/errors";
import { createSparklinePath } from "../../src/render/path";
import {
  createStrongEtag,
  renderErrorSparkline,
  renderSparkline,
  renderSparklineJson,
} from "../../src/render/renderer";

const options = {
  width: 160,
  height: 48,
  theme: "light",
  fill: false,
  ticker: "AAPL",
  timeframe: "1m",
} as const;

describe("sparkline renderer", () => {
  it("matches golden SVGs for compatibility-sensitive shapes", () => {
    const fixtures = {
      rising: [1, 2, 4, 8],
      falling: [8, 4, 2, 1],
      flat: [5, 5, 5],
      single: [42],
      sparse: [3, 9],
      volatile: [0, 100, -80, 120, -20],
      negative: [-20, -12, -16],
      large: [1e250, 1.2e250, 0.9e250],
    } as const;
    const svgs = Object.fromEntries(
      Object.entries(fixtures).map(([name, closes]) => [
        name,
        renderSparkline(
          closes.map((close, timestamp) => ({ timestamp, close })),
          options,
        ),
      ]),
    );
    expect(svgs).toMatchSnapshot();
    expect(
      Object.fromEntries(
        PUBLIC_ERROR_CODES.map((code) => [code, renderErrorSparkline(code)]),
      ),
    ).toMatchSnapshot();
  });

  it("colors each segment from its position against the first close", () => {
    const rising = [
      { timestamp: 0, close: 1 },
      { timestamp: 1, close: 2 },
    ];
    const falling = [
      { timestamp: 0, close: 2 },
      { timestamp: 1, close: 1 },
    ];
    expect(renderSparkline(rising, options)).toContain('stroke="#17854b"');
    expect(renderSparkline(falling, options)).toContain('stroke="#d13c43"');
    expect(
      renderSparkline(
        rising.map((point) => ({ ...point, close: 4 })),
        options,
      ),
    ).toContain('stroke="#17854b"');
    const mixed = renderSparkline(
      [10, 8, 12].map((close, timestamp) => ({ timestamp, close })),
      options,
    );
    expect(mixed).toContain('stroke="#17854b"');
    expect(mixed).toContain('stroke="#d13c43"');
    expect(renderSparkline(rising, options)).toBe(
      renderSparkline(rising, options),
    );
  });

  it("always renders a first-close reference and optionally fills to it", () => {
    const points = [10, 8, 12].map((close, timestamp) => ({
      timestamp,
      close,
    }));
    const lineOnly = renderSparkline(points, options);
    const filled = renderSparkline(points, { ...options, fill: true });
    expect(lineOnly).toContain('stroke-dasharray="2 3"');
    expect(lineOnly).not.toContain('fill-opacity="0.16"');
    expect(filled).toContain('fill="#17854b" fill-opacity="0.16"');
    expect(filled).toContain('fill="#d13c43" fill-opacity="0.16"');
  });

  it("uses timestamp geometry and handles gaps and a single point", () => {
    expect(
      createSparklinePath([
        { timestamp: 0, close: 1 },
        { timestamp: 10, close: 2 },
        { timestamp: 100, close: 3 },
      ]),
    ).toBe("M 4 43 L 19.2 24 L 156 5");
    expect(createSparklinePath([{ timestamp: 10, close: 4 }])).toBe(
      "M 77 24 L 83 24",
    );
  });

  it("filters invalid input and escapes metadata", () => {
    const svg = renderSparkline(
      [
        { timestamp: Number.NaN, close: 3 },
        { timestamp: 2, close: Number.POSITIVE_INFINITY },
        { timestamp: 1, close: 4 },
      ],
      { ...options, ticker: "<script>&\"'" },
    );
    expect(svg).toContain("&lt;script&gt;&amp;&quot;&apos;");
    expect(svg).not.toContain("<script>");
    expect(svg).not.toMatch(/NaN|Infinity|onload=/);
  });

  it("renders only the successful SVG allowlist", () => {
    const svg = renderSparkline([{ timestamp: 1, close: -5 }], options);
    const tags =
      svg.match(/<\/?([a-z]+)/g)?.map((tag) => tag.replace(/[</>]/g, "")) ?? [];
    expect(
      tags.every((tag) => ["svg", "title", "desc", "path"].includes(tag)),
    ).toBe(true);
  });

  it("renders one deterministic neutral fallback per public code", () => {
    for (const code of PUBLIC_ERROR_CODES) {
      const svg = renderErrorSparkline(code);
      expect(svg).toContain(`<title>Sparkline unavailable: ${code}</title>`);
      expect(svg).toContain(`>${code}</text>`);
      expect(svg).toContain('stroke="#8b9099"');
      expect(svg).not.toContain("AAPL");
      expect(svg).toBe(renderErrorSparkline(code));
    }
  });

  it("builds the locked JSON envelope and omits unknown currency", () => {
    const svg = "<svg></svg>";
    expect(
      renderSparklineJson({ dataAsOf: "2026-01-01T00:00:00Z" }, options, svg),
    ).toBe(
      '{"ticker":"AAPL","timeframe":"1m","dataAsOf":"2026-01-01T00:00:00Z","svg":"<svg></svg>"}',
    );
  });

  it("hashes exact response bytes into a strong ETag", async () => {
    expect(await createStrongEtag("abc")).toBe(
      '"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"',
    );
  });

  it("renders arbitrary finite series without unsafe numeric output", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ noNaN: true, noDefaultInfinity: true }), {
          minLength: 1,
          maxLength: 300,
        }),
        (closes) => {
          const svg = renderSparkline(
            closes.map((close, timestamp) => ({ timestamp, close })),
            options,
          );
          expect(svg).not.toMatch(/NaN|Infinity|[ML] -0(?:\s|$)/);
        },
      ),
    );
  });
});
