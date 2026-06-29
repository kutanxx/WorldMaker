import type { Rng } from "../rng";
import type { Point, Polygon } from "../geometry";
import { area, bbox, centroid, splitByLine, insetPolygon } from "../geometry";

export function subdivide(rng: Rng, ward: Polygon, opts: { minArea: number; margin: number }): Polygon[] {
  const out: Polygon[] = [];
  const recurse = (poly: Polygon, depth: number) => {
    if (depth > 9 || area(poly) <= opts.minArea) {
      const lot = insetPolygon(poly, opts.margin);
      if (area(lot) > opts.minArea * 0.15) out.push(lot);
      return;
    }
    const c = centroid(poly);
    const bb = bbox(poly);
    const horizontal = bb.maxX - bb.minX >= bb.maxY - bb.minY;
    const jitter = (rng() - 0.5) * 0.5;
    let a: Point, b: Point;
    if (horizontal) {
      const x = c[0] + (rng() - 0.5) * (bb.maxX - bb.minX) * 0.25;
      a = [x, bb.minY - 1];
      b = [x + jitter * 10, bb.maxY + 1];
    } else {
      const y = c[1] + (rng() - 0.5) * (bb.maxY - bb.minY) * 0.25;
      a = [bb.minX - 1, y];
      b = [bb.maxX + 1, y + jitter * 10];
    }
    const parts = splitByLine(poly, a, b);
    if (parts.length < 2) {
      const lot = insetPolygon(poly, opts.margin);
      if (area(lot) > opts.minArea * 0.15) out.push(lot);
      return;
    }
    for (const part of parts) recurse(part, depth + 1);
  };
  recurse(ward, 0);
  return out;
}
