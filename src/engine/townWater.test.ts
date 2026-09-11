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
