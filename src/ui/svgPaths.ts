import type { Segment } from "../engine/borders";

export function cellPath(poly: number[][]): string {
  if (!poly.length) return "";
  return "M" + poly.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join("L") + "Z";
}

export function segPath(segs: Segment[]): string {
  return segs
    .map(([a, b]) => `M${a[0].toFixed(1)},${a[1].toFixed(1)}L${b[0].toFixed(1)},${b[1].toFixed(1)}`)
    .join("");
}
