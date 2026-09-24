import { describe, it, expect } from "vitest";
import { mulberry32 } from "../rng";
import { area, pointInPolygon, pointSegDist, bbox } from "../geometry";
import type { Point, Polygon } from "../geometry";
import { lots, cathedralChurch, guildHall } from "./buildings";

const ward: Polygon = [[0, 0], [60, 0], [60, 60], [0, 60]];
// the same block turned 30 degrees: a street that does not run along the page
const turned: Polygon = ward.map(([x, y]) => {
  const a = Math.PI / 6;
  return [100 + x * Math.cos(a) - y * Math.sin(a), 100 + x * Math.sin(a) + y * Math.cos(a)] as Point;
});
const edgeDist = (p: Point, poly: Polygon) => {
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) d = Math.min(d, pointSegDist(p, poly[i], poly[(i + 1) % poly.length]));
  return d;
};

describe("buildings.lots", () => {
  it("produces multiple footprints, each smaller than the block", () => {
    const b = lots(mulberry32(1), ward, { minArea: 120 });
    expect(b.length).toBeGreaterThan(4);
    for (const f of b) expect(area(f)).toBeLessThan(area(ward));
  });
  it("smaller minArea yields more (denser) buildings", () => {
    const sparse = lots(mulberry32(2), ward, { minArea: 400 });
    const dense = lots(mulberry32(2), ward, { minArea: 80 });
    expect(dense.length).toBeGreaterThan(sparse.length);
  });
  it("keeps every footprint inside its block", () => {
    const b = lots(mulberry32(3), turned, { minArea: 150 });
    for (const f of b) for (const p of f) expect(pointInPolygon(p, turned) || edgeDist(p, turned) < 1e-6).toBe(true);
  });
  it("is deterministic", () => {
    const a = lots(mulberry32(5), ward, { minArea: 150 });
    const c = lots(mulberry32(5), ward, { minArea: 150 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(c));
  });
  // ★ The cuts used to split the bounding box across its longer side, so a lot's edges lay along the
  // page — on a block turned against it, every house stood askew of its own street (a median 54% of
  // houses more than 15 degrees off, over twelve worlds). A cut across the longest edge keeps them
  // square to the block, whichever way the block is turned.
  it("cuts its lots square to the block's own edges, however the block is turned", () => {
    const b = lots(mulberry32(7), turned, { minArea: 120, chaos: 0 });
    expect(b.length).toBeGreaterThan(8);
    const blockDir = Math.atan2(turned[1][1] - turned[0][1], turned[1][0] - turned[0][0]);
    for (const f of b) for (let i = 0; i < f.length; i++) {
      const p = f[i], q = f[(i + 1) % f.length];
      if (Math.hypot(q[0] - p[0], q[1] - p[1]) < 0.5) continue;
      let d = Math.abs(Math.atan2(q[1] - p[1], q[0] - p[0]) - blockDir) % (Math.PI / 2);
      d = Math.min(d, Math.PI / 2 - d);
      expect(d * (180 / Math.PI)).toBeLessThan(0.01);
    }
  });
  it("leaves the share it is asked to leave open as yards", () => {
    const full = lots(mulberry32(9), ward, { minArea: 60, emptyProb: 0 });
    const gardens = lots(mulberry32(9), ward, { minArea: 60, emptyProb: 0.5 });
    expect(gardens.length).toBeLessThan(full.length * 0.75);
    expect(gardens.length).toBeGreaterThan(full.length * 0.25);
  });
});

describe("the buildings a town has only one of", () => {
  const room: Polygon = [[0, 0], [70, 0], [70, 55], [0, 55]];
  it("builds a cathedral as a cross with its apse to the east, inside its block", () => {
    const ch = cathedralChurch(room)!;
    expect(ch).not.toBeNull();
    for (const p of ch.outline) expect(pointInPolygon(p, room) && edgeDist(p, room) >= 1.5 - 1e-9).toBe(true);
    expect(pointInPolygon(ch.crossing, ch.outline)).toBe(true);
    // the east end is the rounded one, on the nave's line; the west front is flat
    const b = bbox(ch.outline);
    const east = ch.outline.filter((p) => p[0] > b.maxX - 0.01);
    const west = ch.outline.filter((p) => p[0] < b.minX + 0.01);
    expect(east.length).toBe(1);
    expect(Math.abs(east[0][1] - ch.crossing[1])).toBeLessThan(0.01);
    expect(west.length).toBe(2);
    // a cross: its arms reach out across the nave
    expect(b.maxY - b.minY).toBeGreaterThan((b.maxX - b.minX) * 0.5);
  });
  it("turns a cathedral to its block's long side when facing east will not fit", () => {
    const tall: Polygon = [[0, 0], [24, 0], [24, 70], [0, 70]];
    const ch = cathedralChurch(tall)!;
    expect(ch).not.toBeNull();
    const b = bbox(ch.outline);
    expect(b.maxY - b.minY).toBeGreaterThan(b.maxX - b.minX);
  });
  it("builds a guild hall along its block's long side", () => {
    const hall = guildHall(room)!;
    expect(hall).not.toBeNull();
    for (const p of hall.outline) expect(pointInPolygon(p, room)).toBe(true);
    const b = bbox(hall.outline);
    expect(b.maxX - b.minX).toBeGreaterThan((b.maxY - b.minY) * 1.8);
  });
  it("builds neither where there is no room for one", () => {
    const tiny: Polygon = [[0, 0], [8, 0], [8, 8], [0, 8]];
    expect(cathedralChurch(tiny)).toBeNull();
    expect(guildHall(tiny)).toBeNull();
  });
});
