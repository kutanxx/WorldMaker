import { describe, it, expect } from "vitest";
import { mulberry32 } from "../rng";
import { makeCastle } from "./castle";
import { pointInPolygon, centroid } from "../geometry";
import type { Polygon } from "../geometry";

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
  it("emits a postern when the ward touches the town wall", () => {
    // this ward reaches the boundary circle (r=115 from 230,230): vertex [345,250] is ~117 out
    const c = makeCastle(mulberry32(3), ward, [230, 230], boundary, 4)!;
    expect(c.postern).not.toBeNull();
  });
});
