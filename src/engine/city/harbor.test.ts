import { describe, it, expect } from "vitest";
import { mulberry32 } from "../rng";
import type { Polygon, Point } from "../geometry";
import { makeHarbor } from "./harbor";
import type { Water } from "./water";

const ring: Polygon = [];
for (let i = 0; i < 16; i++) {
  const a = (i / 16) * Math.PI * 2;
  ring.push([150 + Math.cos(a) * 60, 150 + Math.sin(a) * 60]);
}
const center: Point = [150, 150];
const noWater: Water = { kind: "none", bodies: [], bridges: [] };
const lake: Water = { kind: "lake", bodies: [[[140, 140], [160, 140], [160, 160], [140, 160]]], bridges: [] };
const rightSea: Water = { kind: "sea", bodies: [[[185, 0], [300, 0], [300, 300], [185, 300]]], bridges: [] };

describe("makeHarbor", () => {
  it("returns null for non-sea water and does not disturb the rng", () => {
    const a = mulberry32(1), b = mulberry32(1);
    expect(makeHarbor(a, noWater, ring, center)).toBeNull();
    expect(makeHarbor(a, lake, ring, center)).toBeNull();
    expect(a()).toBe(b()); // fresh rng at the same seed yields the same next value
  });
  it("builds a breakwater with a lighthouse at its tip, piers and moored boats", () => {
    const h = makeHarbor(mulberry32(3), rightSea, ring, center);
    expect(h).not.toBeNull();
    expect(h!.breakwater.length).toBeGreaterThanOrEqual(2);
    expect(h!.lighthouse).toEqual(h!.breakwater[h!.breakwater.length - 1]);
    expect(h!.piers.length).toBeGreaterThanOrEqual(1);
    expect(h!.boats.length).toBeGreaterThanOrEqual(1);
  });
  it("exposes a quay (waterfront line) spanning the seaward boundary run", () => {
    const h = makeHarbor(mulberry32(3), rightSea, ring, center);
    expect(h!.quay.length).toBeGreaterThanOrEqual(2);
    // the seaward run is the right side, so every quay vertex sits on the sea half
    for (const p of h!.quay) expect(p[0]).toBeGreaterThanOrEqual(150);
  });
  it("lines the quay with warehouse wharves (the visible docks)", () => {
    const h = makeHarbor(mulberry32(3), rightSea, ring, center);
    expect(h!.wharves.length).toBeGreaterThanOrEqual(1);
    for (const wf of h!.wharves) expect(wf.length).toBe(4); // each warehouse is a quad
  });
  // A port comes down to its water now (the shore runs through the edge of the town's reach), so its
  // piers run out from a quay that stands on it. A town that stands back from the sea across a beach
  // keeps a harbour — its mole starts at the shore — but no pier is run over the beach to reach it:
  // they ran a median 60% of their length over dry land when every port stood back from its water.
  it("runs no pier over a beach when the town stands back from the sea", () => {
    // a small ring (right edge ~x=190) with the sea at x>=210 — a ~20px land gap
    const gapRing: Polygon = [];
    for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; gapRing.push([150 + Math.cos(a) * 40, 150 + Math.sin(a) * 40]); }
    const farSea: Water = { kind: "sea", bodies: [[[210, 0], [300, 0], [300, 300], [210, 300]]], bridges: [] };
    const h = makeHarbor(mulberry32(3), farSea, gapRing, center);
    expect(h).not.toBeNull();                       // the harbour is still there
    expect(h!.breakwater[0][0], "its mole starts at the shore").toBeGreaterThanOrEqual(209);
    expect(h!.piers).toEqual([]);
  });
  it("sets the piers in the basin the mole shelters, clear of the mole and of each other", () => {
    const gap = (a: Point[], b: Point[]) => {
      const seg = (p: Point, q: Point, r: Point) => { const dx = r[0] - q[0], dy = r[1] - q[1], l2 = dx * dx + dy * dy; const t = l2 ? Math.max(0, Math.min(1, ((p[0] - q[0]) * dx + (p[1] - q[1]) * dy) / l2)) : 0; return Math.hypot(p[0] - q[0] - t * dx, p[1] - q[1] - t * dy); };
      let d = Infinity;
      for (let i = 0; i + 1 < a.length; i++) for (let j = 0; j + 1 < b.length; j++) d = Math.min(d, seg(a[i], b[j], b[j + 1]), seg(a[i + 1], b[j], b[j + 1]), seg(b[j], a[i], a[i + 1]), seg(b[j + 1], a[i], a[i + 1]));
      return d;
    };
    for (let s = 1; s <= 20; s++) {
      const h = makeHarbor(mulberry32(s), rightSea, ring, center)!;
      const [from, mid, tip] = h.breakwater;
      // the side of the mole's first arm its head turns to
      const side = (p: Point) => Math.sign((mid[0] - from[0]) * (p[1] - from[1]) - (mid[1] - from[1]) * (p[0] - from[0]));
      for (const pr of h.piers) {
        expect(gap(pr, h.breakwater), `seed ${s}: a pier on the mole`).toBeGreaterThanOrEqual(3.5);
        if (tip) expect(side(pr[pr.length - 1]), `seed ${s}: a pier outside the basin`).toBe(side(tip));
      }
      for (let i = 0; i < h.piers.length; i++) for (let j = i + 1; j < h.piers.length; j++) expect(gap(h.piers[i], h.piers[j])).toBeGreaterThanOrEqual(3.5);
    }
  });
  it("is deterministic for a given seed", () => {
    const a = JSON.stringify(makeHarbor(mulberry32(5), rightSea, ring, center));
    const b = JSON.stringify(makeHarbor(mulberry32(5), rightSea, ring, center));
    expect(a).toBe(b);
  });
});
