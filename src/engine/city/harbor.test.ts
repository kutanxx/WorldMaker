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
  it("is deterministic for a given seed", () => {
    const a = JSON.stringify(makeHarbor(mulberry32(5), rightSea, ring, center));
    const b = JSON.stringify(makeHarbor(mulberry32(5), rightSea, ring, center));
    expect(a).toBe(b);
  });
});
