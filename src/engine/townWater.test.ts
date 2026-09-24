import { describe, it, expect } from "vitest";
import { generateWorld } from "./world";
import { DEFAULT_PARAMS } from "../types/world";

// Towns used to be thrown at the claimed land uniformly, and the measurement said exactly that: the
// pool was 26.8% coastal and the towns came out 27% coastal — statistically indistinguishable from
// darts. 67% of them sat on neither a coast nor a river, and three seeds in twelve had NO river town
// at all. Towns exist because of water: drinking, carrying, defending.
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const worlds = SEEDS.map((seed) => generateWorld({ ...DEFAULT_PARAMS, seed }).world);
const towns = (w: (typeof worlds)[number]) => w.cities.filter((c) => !c.isCapital);
const share = (f: (c: { coastal: boolean; river: boolean }) => boolean) => {
  let hit = 0, all = 0;
  for (const w of worlds) for (const c of towns(w)) { all++; if (f(c)) hit++; }
  return hit / all;
};

describe("towns stand on water", () => {
  it("puts most of them on a coast or a river", () => {
    const wet = share((c) => c.coastal || c.river);
    expect(wet, `only ${(wet * 100).toFixed(0)}% of towns touch water`).toBeGreaterThan(0.55);
  });

  // ...but not all of them: a map whose every town is on water has no mining camp, no crossroads,
  // no hill fort, and reads as a different kind of lie.
  it("leaves a real share of them inland", () => {
    const dry = share((c) => !c.coastal && !c.river);
    expect(dry, `only ${(dry * 100).toFixed(0)}% of towns are inland`).toBeGreaterThan(0.15);
  });

  it("gives every map at least one river town", () => {
    for (const w of worlds) {
      const n = towns(w).filter((c) => c.river).length;
      expect(n, `seed ${w.params.seed} has no town on a river`).toBeGreaterThan(0);
    }
  });

  // ⚠ The pool holds a cell once however heavily it is weighted: two towns on one cell would sit on
  // top of each other.
  it("never puts two towns on the same cell", () => {
    for (const w of worlds) {
      const cells = w.cities.map((c) => c.cell);
      expect(new Set(cells).size, `seed ${w.params.seed} placed two towns on one cell`).toBe(cells.length);
    }
  });

  // The bias has to be a bias, not a cull: the interior must still be settled.
  it("does not strand the interior", () => {
    for (const w of worlds) {
      const inland = towns(w).filter((c) => !c.coastal && !c.river).length;
      expect(inland, `seed ${w.params.seed} put every town on water`).toBeGreaterThan(1);
    }
  });
});

// What the world's river does at a river town, read off the network the map draws: whether it rises
// there (the map first draws it at the town, no feeder coming in), and otherwise how far it turns. The
// plate put a town in a loop of its river on a coin toss — 7 of 17 of them where the river rises.
describe("what the river does at a river town", () => {
  it("says where the river rises, and how far it turns everywhere else", () => {
    let rises = 0, turns = 0;
    for (const w of worlds) {
      for (const c of w.cities) {
        if (!c.river) {
          expect(c.riverRises, `${c.name} has no river`).toBeUndefined();
          expect(c.riverTurn, `${c.name} has no river`).toBeUndefined();
          continue;
        }
        const feeders = w.riverNet.filter((g) => g.x2 === c.x && g.y2 === c.y);
        const out = w.riverNet.find((g) => g.x1 === c.x && g.y1 === c.y)!;
        expect(c.riverRises, `where the river of ${c.name} rises`).toBe(feeders.length === 0);
        if (!feeders.length) { rises++; expect(c.riverTurn).toBeUndefined(); continue; }
        turns++;
        const main = feeders.reduce((a, b) => (b.f > a.f ? b : a));
        // the heading its biggest feeder comes in by, turned by riverTurn, is the heading it leaves by
        const a1 = Math.atan2(main.y2 - main.y1, main.x2 - main.x1) + c.riverTurn!;
        const a2 = Math.atan2(out.y2 - out.y1, out.x2 - out.x1);
        expect(Math.abs(Math.atan2(Math.sin(a1 - a2), Math.cos(a1 - a2))), `the turn of the river at ${c.name}`).toBeLessThan(1e-9);
        expect(Math.abs(c.riverTurn!)).toBeLessThanOrEqual(Math.PI);
      }
    }
    expect(rises).toBeGreaterThan(15);
    expect(turns).toBeGreaterThan(40);
  });
});
