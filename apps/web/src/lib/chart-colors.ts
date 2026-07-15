import type { CSSProperties } from 'react';

/**
 * App-wide categorical chart palette. The actual color values live in
 * styles.css as `--chart-1..5` (with paired `--chart-N-foreground` inks);
 * this module just names the slots so charts and the audit icon tiles assign
 * them consistently in JS.
 *
 * Assign colors in order and never cycle — a series beyond the palette folds
 * into `CHART_OTHER_COLOR` rather than reusing a hue. The slot order matches
 * the CVD-validated ordering in styles.css.
 */
export const CHART_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
] as const;

/** Neutral fold-in for the "Other" bucket; recessive against the vivid palette. */
export const CHART_OTHER_COLOR = 'var(--chart-other)';

/**
 * Foreground ink legible on a solid fill of a palette color. Each `--chart-*`
 * token pairs with a `--chart-*-foreground` (the shadcn `--primary` /
 * `--primary-foreground` convention), so we derive the ink from the fill's
 * var name — white on most hues, dark on the light yellow.
 */
export function onColorInk(color: string): string {
  return color.replace(/var\((--[\w-]+)\)/, 'var($1-foreground)');
}

/**
 * Inline style for a solid icon tile in a palette color: the color as fill,
 * its paired `-foreground` token as the icon ink.
 */
export function solidTileStyle(color: string): CSSProperties {
  return { backgroundColor: color, color: onColorInk(color) };
}
