import { Delaunay } from "d3-delaunay";
import type { Rng } from "./rng";

export interface Grid {
  width: number;
  height: number;
  count: number;
  points: number[];
  polygons: number[][][];
  neighbors: number[][];
  find(x: number, y: number): number;
}

function buildDelaunay(pts: Float64Array, count: number) {
  const coords: [number, number][] = [];
  for (let i = 0; i < count; i++) coords.push([pts[i * 2], pts[i * 2 + 1]]);
  return Delaunay.from(coords);
}

export function generateGrid(
  rng: Rng,
  width: number,
  height: number,
  count: number,
  relaxations = 2
): Grid {
  const pts = new Float64Array(count * 2);
  for (let i = 0; i < count; i++) {
    pts[i * 2] = rng() * width;
    pts[i * 2 + 1] = rng() * height;
  }
  let delaunay = buildDelaunay(pts, count);
  let voronoi = delaunay.voronoi([0, 0, width, height]);
  for (let r = 0; r < relaxations; r++) {
    for (let i = 0; i < count; i++) {
      const poly = voronoi.cellPolygon(i);
      if (!poly) continue;
      const n = poly.length - 1;
      let cx = 0, cy = 0;
      for (let k = 0; k < n; k++) { cx += poly[k][0]; cy += poly[k][1]; }
      pts[i * 2] = cx / n;
      pts[i * 2 + 1] = cy / n;
    }
    delaunay = buildDelaunay(pts, count);
    voronoi = delaunay.voronoi([0, 0, width, height]);
  }
  const polygons: number[][][] = [];
  const neighbors: number[][] = [];
  for (let i = 0; i < count; i++) {
    const poly = voronoi.cellPolygon(i);
    polygons.push(poly ? poly.map(([x, y]) => [x, y]) : []);
    neighbors.push([...voronoi.neighbors(i)]);
  }
  return {
    width,
    height,
    count,
    points: Array.from(pts),
    polygons,
    neighbors,
    find: (x, y) => delaunay.find(x, y),
  };
}
