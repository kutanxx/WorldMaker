/**
 * Colour arithmetic the page's keys and tints share: a colour laid over another at an opacity, the way the
 * browser composites a fill — so a key's swatch can say the colour the map actually paints (a realm's
 * colour at 0.58 over the muted ground is not the realm's colour), and a province can take its realm's
 * colour a step lighter. Hex in, hex out; integer arithmetic only.
 */

/** "#rrggbb" → [r, g, b] (0–255) */
export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** [r, g, b] → "#rrggbb", each channel rounded and clamped */
export function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** `top` laid over `under` at `opacity`: what the browser shows where a translucent fill covers a ground */
export function over(top: string, under: string, opacity: number): string {
  const a = hexToRgb(top), b = hexToRgb(under);
  return rgbToHex(a[0] * opacity + b[0] * (1 - opacity), a[1] * opacity + b[1] * (1 - opacity), a[2] * opacity + b[2] * (1 - opacity));
}

/** `colour` lightened by `k` of the way to white (0 = itself, 1 = white) */
export function lighter(colour: string, k: number): string {
  return over("#ffffff", colour, k);
}
