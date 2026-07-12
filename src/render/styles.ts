import type { Theme } from "../domain/request";

export const SVG_WIDTH = 160 as const;
export const SVG_HEIGHT = 48 as const;
export const SVG_PADDING_X = 4;
export const SVG_PADDING_Y = 5;

export type ChartTone = "green" | "red";

const PALETTES = {
  light: {
    green: "#17854b",
    red: "#d13c43",
    baseline: "#9ca3af",
  },
  dark: {
    green: "#35c978",
    red: "#f0646b",
    baseline: "#697386",
  },
} as const;

export function resolveToneColor(theme: Theme, tone: ChartTone): string {
  return PALETTES[theme][tone];
}

export function resolveBaselineColor(theme: Theme): string {
  return PALETTES[theme].baseline;
}
