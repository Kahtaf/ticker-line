import type { Color, Theme } from "../domain/request";

export const SVG_WIDTH = 160 as const;
export const SVG_HEIGHT = 48 as const;
export const SVG_PADDING_X = 4;
export const SVG_PADDING_Y = 5;

const PALETTES = {
  light: {
    green: "#17854b",
    red: "#d13c43",
    blue: "#2563eb",
    gray: "#6b7280",
  },
  dark: {
    green: "#35c978",
    red: "#f0646b",
    blue: "#60a5fa",
    gray: "#a3aab8",
  },
} as const;

export function resolveStroke(
  theme: Theme,
  color: Color,
  firstClose: number,
  lastClose: number,
): string {
  const resolved =
    color === "auto"
      ? lastClose > firstClose
        ? "green"
        : lastClose < firstClose
          ? "red"
          : "gray"
      : color;
  return PALETTES[theme][resolved];
}
