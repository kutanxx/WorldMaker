import type { Segment, Point } from "../engine/borders";
import { noisyEdge } from "./noisyEdge";

const xy = ([x, y]: Point) => `${x.toFixed(1)},${y.toFixed(1)}`;

// Every cell edge on the map is wobbled by `noisyEdge`, which computes one curve per edge rather
// than per cell, so a fill and the border drawn on top of it follow exactly the same line.
const edge = (a: Point, b: Point) => noisyEdge(a, b).map(xy).join("L");

export function cellPath(poly: number[][]): string {
  if (!poly.length) return "";
  let d = "M" + xy(poly[0] as Point);
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i] as Point, b = poly[(i + 1) % poly.length] as Point;
    const mid = edge(a, b);
    d += (mid ? "L" + mid : "") + "L" + xy(b);
  }
  return d + "Z";
}

/**
 * `noisy` is on by default because almost every caller is drawing cell edges — coastlines, national
 * and provincial borders — and those must match the fills beneath them. Rivers are the exception:
 * their segments run between cell CENTRES, not along cell edges, so wobbling them would walk the
 * water off its own course.
 */
export function segPath(segs: Segment[], noisy = true): string {
  return segs
    .map(([a, b]) => {
      const mid = noisy ? edge(a, b) : "";
      return `M${xy(a)}${mid ? "L" + mid : ""}L${xy(b)}`;
    })
    .join("");
}
