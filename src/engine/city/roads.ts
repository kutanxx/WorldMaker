import type { Point, Polyline } from "../geometry";

export function buildRoads(plaza: Point, gates: Point[]): Polyline[] {
  const roads: Polyline[] = [];
  for (const g of gates) {
    const mid: Point = [(g[0] + plaza[0]) / 2 + (plaza[1] - g[1]) * 0.08, (g[1] + plaza[1]) / 2 + (g[0] - plaza[0]) * 0.08];
    roads.push([g, mid, plaza]);
  }
  const ring: Polyline = [];
  const r = 22;
  for (let i = 0; i <= 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    ring.push([plaza[0] + Math.cos(a) * r, plaza[1] + Math.sin(a) * r]);
  }
  roads.push(ring);
  return roads;
}
