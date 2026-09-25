import { describe, it, expect } from "vitest";
import { mulberry32 } from "../rng";
import type { Polygon, Point } from "../geometry";
import { makeMountains, inMountains, makeHill } from "./mountain";
import { selectArchetype, TABLE } from "./archetypes";

const bounds = { w: 300, h: 300 };
const center: Point = [150, 150];
const ring: Polygon = [];
for (let i = 0; i < 22; i++) {
  const a = (i / 22) * Math.PI * 2;
  ring.push([150 + Math.cos(a) * 60, 150 + Math.sin(a) * 60]);
}
const mtn = { coastal: false, elevation: 0.9, size: 4, biome: 4 };
const arch = (pick: number) => selectArchetype({ ...mtn, pick });

describe("makeMountains", () => {
  it("returns [] for non-mountain archetypes without drawing rng", () => {
    const rngA = mulberry32(1), rngB = mulberry32(1);
    const plains = selectArchetype({ ...mtn, elevation: 0.5, biome: 4 }); // plainsMarket
    expect(makeMountains(rngA, plains, ring, center, bounds)).toEqual([]);
    // the rng must be untouched: a fresh rng at the same seed yields the same next value
    expect(rngA()).toBe(rngB());
  });
  // named rather than reached through `pick`: the variant list grows, and a test that says "0.6
  // means spur" breaks for a reason that has nothing to do with what it is checking.
  it("gives each kind of high ground the number of masses its shape needs", () => {
    expect(makeMountains(mulberry32(3), TABLE.hillside, ring, center, bounds).length).toBe(1);
    expect(makeMountains(mulberry32(3), TABLE.spur, ring, center, bounds).length).toBe(1);
    expect(makeMountains(mulberry32(3), TABLE.valleyPass, ring, center, bounds).length).toBe(2);
    expect(makeMountains(mulberry32(3), TABLE.hilltopFortress, ring, center, bounds).length).toBe(1);
  });
  it("each mass is a closed-ish polygon with an inner edge; interior sits outside the rim", () => {
    const masses = makeMountains(mulberry32(7), arch(0.3), ring, center, bounds);
    for (const m of masses) {
      expect(m.polygon.length).toBeGreaterThanOrEqual(4);
      expect(m.innerEdge.length).toBeGreaterThanOrEqual(2);
    }
    // the city centre is never inside a mass; a point just outside a covered rim vertex is
    expect(inMountains(masses, center)).toBe(false);
    const rimV = masses[0].innerEdge[0];
    const outward: Point = [rimV[0] + (rimV[0] - 150) * 0.15, rimV[1] + (rimV[1] - 150) * 0.15];
    expect(inMountains(masses, outward)).toBe(true);
  });
  it("is deterministic for a given rng seed", () => {
    const a = makeMountains(mulberry32(5), arch(0.6), ring, center, bounds);
    const b = makeMountains(mulberry32(5), arch(0.6), ring, center, bounds);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

// makeMountains listed hillside, spur and valleyPass and stopped there, so the one mountain variant
// named for its high ground was the one that never got any: a hilltop fortress was drawn on a flat
// plain. It gets a single broad shoulder rather than a full collar -- the masses run out to the edge
// of the plate, and a ring of them would swallow the fields and hamlets outside the wall.
describe("the fortress on the hill", () => {
  const ring: Polygon = Array.from({ length: 24 }, (_, i) => {
    const a = (i / 24) * Math.PI * 2;
    return [center[0] + Math.cos(a) * 60, center[1] + Math.sin(a) * 60] as Point;
  });
  it("stands on high ground like the other mountain kinds", () => {
    const arch = selectArchetype({ coastal: false, elevation: 0.9, size: 3, biome: 4, pick: 0 });
    expect(arch.id).toBe("hilltopFortress");
    expect(makeMountains(mulberry32(5), arch, ring, center, bounds).length).toBeGreaterThan(0);
  });
  it("keeps ground open outside the wall for its fields and hamlets", () => {
    const arch = selectArchetype({ coastal: false, elevation: 0.9, size: 3, biome: 4, pick: 0 });
    const masses = makeMountains(mulberry32(5), arch, ring, center, bounds);
    // sample the ring of ground just outside the wall: a collar of rock would leave nowhere to farm
    let open = 0, total = 0;
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      const p: Point = [center[0] + Math.cos(a) * 80, center[1] + Math.sin(a) * 80];
      total++;
      if (!inMountains(masses, p)) open++;
    }
    expect(open / total).toBeGreaterThan(0.4);
  });
});

// The high ground stands where the world has it: a mountain town's masses face the world's mountains,
// and a town at their foot has them rise past its fields — they used to face a direction the plate drew
// for itself (9 of 15 mountain towns more than 45 degrees off), and a foothill town drew none.
describe("the world's mountains on the plate", () => {
  const plains = TABLE.plainsMarket;
  const facing = (m: { innerEdge: Point[] }) => {
    let x = 0, y = 0;
    for (const p of m.innerEdge) { x += p[0] - center[0]; y += p[1] - center[1]; }
    return Math.atan2(y, x);
  };
  const off = (a: number, b: number) => { let d = Math.abs(a - b) % (2 * Math.PI); if (d > Math.PI) d = 2 * Math.PI - d; return d; };

  it("turns a mountain town's high ground toward the world's mountains", () => {
    for (const bearing of [-2.5, -1, 0.4, 2]) {
      for (const kind of [TABLE.hilltopFortress, TABLE.hillside]) {
        const [m] = makeMountains(mulberry32(3), kind, ring, center, bounds, { bearing });
        expect(off(facing(m), bearing), `${kind.id} toward ${bearing}`).toBeLessThan(0.3);
      }
    }
  });

  // A spur hangs off the high ground behind it. It was drawn as three wedges spaced round the town,
  // which read as mountains on every side of it.
  it("hangs a spur town off one narrow ridge behind it", () => {
    for (const dir of [-2, 0.5, 2.8]) {
      const masses = makeMountains(mulberry32(3), TABLE.spur, ring, center, bounds, { facing: dir });
      expect(masses.length).toBe(1);
      expect(masses[0].steep).toBe(true);
      expect(off(facing(masses[0]), dir)).toBeLessThan(0.2);
      const rel = masses[0].innerEdge.map((p) => { const a = Math.atan2(p[1] - center[1], p[0] - center[0]) - dir; return Math.atan2(Math.sin(a), Math.cos(a)); });
      expect(Math.max(...rel) - Math.min(...rel), "a ridge, not a massif").toBeLessThan(Math.PI / 2);
    }
  });

  // Where the world says how the ground a mountain town stands on lies (see relief.ts), its high ground
  // faces that way rather than toward the mountain cells beside it: on a summit those lie all round,
  // lower than the town, and its ridge runs one way.
  it("faces a mountain town's high ground the way its own ground rises", () => {
    for (const kind of [TABLE.hilltopFortress, TABLE.hillside, TABLE.spur]) {
      const [m] = makeMountains(mulberry32(3), kind, ring, center, bounds, { bearing: 0, facing: 2.2 });
      expect(off(facing(m), 2.2), kind.id).toBeLessThan(0.3);
    }
    // a valley's two walls stand one each side of it, on the line its relief gives
    const walls = makeMountains(mulberry32(3), TABLE.valleyPass, ring, center, bounds, { bearing: 0, facing: 1.2 });
    expect(walls.length).toBe(2);
    for (const w of walls) expect(Math.min(off(facing(w), 1.2), off(facing(w), 1.2 + Math.PI))).toBeLessThan(0.3);
    expect(off(facing(walls[0]), facing(walls[1]))).toBeGreaterThan(Math.PI - 0.3);
  });

  // A town on a summit stands ON its hill: the ground falls away from its wall all round, steep and
  // short on every side, long and gentle toward its ridge. It had one broad shoulder of rock instead,
  // 30-34% of its plate, which read as a town at the foot of a massif.
  it("sets a hill-top town on its hill: its slope falls away all round it, gentlest toward its ridge", () => {
    for (const ridge of [-2.2, 0.5, 2]) {
      const hill = makeHill(ring, center, bounds, ridge);
      expect(hill.brow.length).toBe(hill.foot.length);
      expect(hill.brow.length).toBeGreaterThan(60);
      const width = (i: number) => Math.hypot(hill.foot[i][0] - hill.brow[i][0], hill.foot[i][1] - hill.brow[i][1]);
      const bearing = (i: number) => Math.atan2(hill.brow[i][1] - center[1], hill.brow[i][0] - center[0]);
      for (let i = 0; i < hill.brow.length; i++) {
        // the brow just outside the wall (a ring of radius 60 here), the foot further out, all on the plate
        expect(Math.hypot(hill.brow[i][0] - center[0], hill.brow[i][1] - center[1])).toBeGreaterThan(60);
        expect(width(i)).toBeGreaterThan(5);
        for (const p of [hill.brow[i], hill.foot[i]]) { expect(p[0]).toBeGreaterThanOrEqual(0); expect(p[0]).toBeLessThanOrEqual(bounds.w); expect(p[1]).toBeGreaterThanOrEqual(0); expect(p[1]).toBeLessThanOrEqual(bounds.h); }
      }
      const toward = hill.brow.map((_, i) => i).filter((i) => off(bearing(i), ridge) < 0.3).map(width);
      const away = hill.brow.map((_, i) => i).filter((i) => off(bearing(i), ridge + Math.PI) < 0.3).map(width);
      expect(Math.min(...toward), `toward ${ridge}`).toBeGreaterThan(Math.max(...away) * 2);
      // the band is the slope and nothing else: the town is not on it, the country past its foot is not
      expect(inMountains([{ polygon: hill.band, innerEdge: hill.brow, steep: false }], center)).toBe(false);
      const mid = hill.brow.length >> 2;
      const on: Point = [(hill.brow[mid][0] + hill.foot[mid][0]) / 2, (hill.brow[mid][1] + hill.foot[mid][1]) / 2];
      expect(inMountains([{ polygon: hill.band, innerEdge: hill.brow, steep: false }], on)).toBe(true);
    }
  });

  // A town out on a spur stands on it the same way: its ground falls away round its flanks and down its
  // tip — steep and short on the flanks, longer down the tip where the ridge line runs on — and rises
  // behind it up the ridge, where its rock is, so no slope is drawn there.
  it("sets a spur town out on its spur: its slope falls round the flanks and the tip, not up the ridge", () => {
    for (const ridge of [-2.2, 0.5, 2]) {
      const hill = makeHill(ring, center, bounds, ridge, "spur");
      const width = (i: number) => Math.hypot(hill.foot[i][0] - hill.brow[i][0], hill.foot[i][1] - hill.brow[i][1]);
      const bearing = (i: number) => Math.atan2(hill.brow[i][1] - center[1], hill.brow[i][0] - center[0]);
      const at = (dir: number) => hill.brow.map((_, i) => i).filter((i) => off(bearing(i), dir) < 0.2).map(width);
      for (const w of at(ridge)) expect(w, `up the ridge at ${ridge}`).toBeLessThan(2);
      for (const side of [ridge + Math.PI / 2, ridge - Math.PI / 2]) for (const w of at(side)) {
        expect(w, `a flank at ${ridge}`).toBeGreaterThan(12);
        expect(w, `a flank at ${ridge}`).toBeLessThan(20);
      }
      for (const w of at(ridge + Math.PI)) expect(w, `the tip at ${ridge}`).toBeGreaterThan(25);
    }
  });

  it("runs a hill-top town's ridge on past its fields, narrow, the way the world's high ground runs", () => {
    for (const ridge of [-2.2, 0.5, 2]) {
      const masses = makeMountains(mulberry32(3), TABLE.hilltopFortress, ring, center, bounds, { facing: ridge, rng: mulberry32(9) });
      expect(masses.length).toBeGreaterThan(0);
      for (const m of masses) {
        expect(off(facing(m), ridge)).toBeLessThan(0.5);
        for (const p of m.innerEdge) expect(Math.hypot(p[0] - center[0], p[1] - center[1]), "past the hill and its fields").toBeGreaterThan(60 + 40);
      }
      const angles = masses.flatMap((m) => m.innerEdge.map((p) => { const a = Math.atan2(p[1] - center[1], p[0] - center[0]) - ridge; return Math.atan2(Math.sin(a), Math.cos(a)); }));
      expect(Math.max(...angles) - Math.min(...angles), "a ridge, not a shoulder").toBeLessThan(1.3);
    }
  });

  it("raises foothills past a town's fields on the side the world's mountains are", () => {
    const masses = makeMountains(mulberry32(3), plains, ring, center, bounds, { bearing: 0.8, share: 0.4, rng: mulberry32(9) });
    expect(masses.length).toBe(1);
    expect(off(facing(masses[0]), 0.8)).toBeLessThan(0.2);
    // the town keeps its own ground: the band begins well past the wall (radius 60 here)
    for (const p of masses[0].innerEdge) expect(Math.hypot(p[0] - center[0], p[1] - center[1])).toBeGreaterThan(60 + 25);
    // ...and without a site, or with no mountains beside it, a plains town has none
    expect(makeMountains(mulberry32(3), plains, ring, center, bounds)).toEqual([]);
  });

  it("widens the foothills the more of the town's neighbours are mountains", () => {
    const span = (share: number) => {
      const [m] = makeMountains(mulberry32(3), plains, ring, center, bounds, { bearing: 0, share, rng: mulberry32(9) });
      const angles = m.innerEdge.map((p) => Math.atan2(p[1] - center[1], p[0] - center[0]));
      return Math.max(...angles) - Math.min(...angles);
    };
    expect(span(0.8)).toBeGreaterThan(span(0.2) * 1.8);
  });

  it("lets a river run out through the foothills rather than under them", () => {
    // a river crossing the band due east of the town
    const wet = (p: Point) => Math.abs(p[1] - center[1]) < 8 && p[0] > center[0];
    const masses = makeMountains(mulberry32(3), plains, ring, center, bounds, { bearing: 0, share: 0.5, rng: mulberry32(9), wet });
    expect(masses.length, "the band is cut in two").toBe(2);
    for (const m of masses) for (let x = 0; x < bounds.w; x += 2) for (let y = center[1] - 7; y <= center[1] + 7; y += 2) {
      if (!wet([x, y])) continue;
      expect(inMountains([m], [x, y]), `mountain over the river at ${x},${y}`).toBe(false);
    }
  });
});
