import { describe, it, expect } from "vitest";
import { mulberry32 } from "../rng";
import { makeCastle } from "./castle";
import { pointInPolygon, centroid, polysOverlap, area } from "../geometry";
import type { Polygon, Point } from "../geometry";

const ward: Polygon = [[300, 180], [340, 200], [345, 250], [310, 275], [275, 240], [278, 200]];
const boundary: Polygon = (() => { const b: Polygon = []; for (let k = 0; k < 24; k++) { const a = (k / 24) * Math.PI * 2; b.push([230 + Math.cos(a) * 115, 230 + Math.sin(a) * 115]); } return b; })();

describe("makeCastle", () => {
  it("builds an inner wall inside the ward with towers, a gate toward town, and a keep", () => {
    const c = makeCastle(mulberry32(3), ward, [230, 230], boundary, 4)!;
    expect(c).not.toBeNull();
    for (const p of c.innerWall) expect(pointInPolygon(p, ward)).toBe(true);
    expect(c.towers.length).toBe(c.innerWall.length);
    expect(pointInPolygon(centroid(c.keep), c.innerWall)).toBe(true);
    // the gate faces the town: nearer the town center than the ward centroid is
    const wc = centroid(ward);
    expect(Math.hypot(c.gate[0] - 230, c.gate[1] - 230)).toBeLessThan(Math.hypot(wc[0] - 230, wc[1] - 230));
    expect(c.annexes.length).toBeGreaterThanOrEqual(1); // size 4: hall/chapel
  });
  it("small towns get a fortified manor: keep but no annexes", () => {
    const c = makeCastle(mulberry32(3), ward, [230, 230], boundary, 1)!;
    expect(c.annexes.length).toBe(0);
  });
  it("annexes never overlap each other or the keep (seed sweep)", () => {
    for (let s = 1; s <= 40; s++) {
      const c = makeCastle(mulberry32(s), ward, [230, 230], boundary, 4)!;
      for (let i = 0; i < c.annexes.length; i++) {
        expect(polysOverlap(c.annexes[i], c.keep)).toBe(false);
        for (let j = i + 1; j < c.annexes.length; j++) expect(polysOverlap(c.annexes[i], c.annexes[j])).toBe(false);
      }
    }
  });
  it("emits a postern when the ward touches the town wall", () => {
    // this ward reaches the boundary circle (r=115 from 230,230): vertex [345,250] is ~117 out
    const c = makeCastle(mulberry32(3), ward, [230, 230], boundary, 4)!;
    expect(c.postern).not.toBeNull();
  });
});

// A castle read the same at every size worth having one. `kr`, the keep's half-width, was a two-step
// switch -- 3 below size 3 and 4.2 at or above it -- so measured over fifteen seeds the keep came out
// at exactly two areas, 36 and 71, and a size-6 royal capital's donjon was identical to a size-3
// market town's. The enclosure did grow with the town, because the ward it sits in scales, but not
// the thing a reader actually reads as the castle. A seat of a great realm should look like one.
describe("a great town's castle looks like one", () => {
  const disc = (r: number): Polygon => Array.from({ length: 12 }, (_, i) => {
    const a = (i / 12) * Math.PI * 2;
    return [150 + Math.cos(a) * r, 150 + Math.sin(a) * r] as Point;
  });
  const bigBoundary = disc(120);
  const keepArea = (size: number) => {
    const c = makeCastle(mulberry32(4), disc(30), [150, 150], bigBoundary, size)!;
    expect(c).not.toBeNull();
    return area(c.keep);
  };
  it("grows the keep with the size of the town, not in two steps", () => {
    const areas = [1, 2, 3, 4, 5, 6].map(keepArea);
    for (let i = 1; i < areas.length; i++) {
      expect(areas[i], `size ${i + 1} vs ${i}`).toBeGreaterThan(areas[i - 1]);
    }
    expect(areas[5]).toBeGreaterThan(areas[2] * 1.5); // a capital's donjon against a market town's
  });
  it("keeps the donjon inside its own inner wall at every size", () => {
    for (const size of [1, 2, 3, 4, 5, 6]) {
      const c = makeCastle(mulberry32(4), disc(30), [150, 150], bigBoundary, size)!;
      for (const p of c.keep) expect(pointInPolygon(p, c.innerWall), `size ${size}`).toBe(true);
    }
  });
});
