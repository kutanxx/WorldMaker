import { describe, it, expect } from "vitest";
import { NATION_PALETTE, nationColor, nationCentroids, assignNationColors } from "./nationPalette";
import { generateWorld } from "../engine/world";
import { DEFAULT_PARAMS } from "../types/world";
import { simulateHistory } from "../engine/history";

describe("nationColor", () => {
  it("is stable and cycles through the palette", () => {
    expect(nationColor(0)).toBe(NATION_PALETTE[0]);
    expect(nationColor(NATION_PALETTE.length)).toBe(NATION_PALETTE[0]);
    expect(nationColor(3)).toBe(NATION_PALETTE[3]);
  });
  it("gives distinct colors to the first several ids", () => {
    const seen = new Set([0, 1, 2, 3, 4, 5].map(nationColor));
    expect(seen.size).toBe(6);
  });
  it("handles negative ids without crashing", () => {
    expect(NATION_PALETTE).toContain(nationColor(-1));
  });
});

describe("nationCentroids", () => {
  // 4 cells: polity 0 owns cells at x=0 and x=2 (mean x=1), polity 1 owns x=10; cell3 ocean(-1)
  const grid = { count: 4, points: [0, 0, 2, 0, 10, 0, 5, 5] };
  const owner = [0, 0, 1, -1];
  it("anchors on the owned cell nearest the mean (a medoid) and counts cells, skipping unowned", () => {
    const c = nationCentroids(grid, owner);
    expect(c.size).toBe(2);
    // mean of polity 0 is x=1; nearest owned cell is x=0 (tie with x=2, first wins) — never a bare mean
    // that could fall off the territory (in the sea or a neighbour for a concave/post-conquest shape)
    expect(c.get(0)).toEqual({ x: 0, y: 0, cells: 2 });
    expect(c.get(1)).toEqual({ x: 10, y: 0, cells: 1 });
  });
  it("keeps the anchor on an owned cell for an L-shaped (concave) territory", () => {
    // an L: the mean falls in the empty corner, but the anchor must snap back onto a member cell
    const g = { count: 3, points: [0, 0, 10, 0, 0, 10] };
    const c = nationCentroids(g, [0, 0, 0]);
    const anchor = c.get(0)!;
    const onCell = [[0, 0], [10, 0], [0, 10]].some(([x, y]) => x === anchor.x && y === anchor.y);
    expect(onCell).toBe(true);
  });
});

// `nationColor` indexes the twelve-colour palette by polity id, so id 12 is drawn in exactly the
// colour of id 0. Worlds create 15-22 realms, and civil-war fragments take the high ids while
// appearing right beside the parent they broke away from — so the two realms drawn identically are
// often the two realms sharing a border. Measured over twelve seeds: every world had two living
// realms in one colour, and SEVEN of the twelve had two of them touching on the province-snapped
// map the reader is shown, which draws the border between them as no border at all. (Rebalancing
// the history made it worse — 5/12 to 8/12 by raw ownership — by leaving more realms alive; it did
// not cause it.)
//
// So the colours are assigned the way a cartographer assigns them: no two realms that ever share a
// border share a colour. The adjacency is unioned over the WHOLE history, which is what lets a
// realm keep one colour from its founding to its fall — a realm that changed colour as its
// neighbours came and went would be worse than the collision.
describe("assignNationColors", () => {
  const build = (seed: number) => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed });
    return { world, history: simulateHistory(world, seed) };
  };
  // every pair of realms that is adjacent in any single snapshot
  const adjacencyOf = (world: ReturnType<typeof build>["world"], history: ReturnType<typeof build>["history"]) => {
    const pairs = new Set<string>();
    for (const snap of history.snapshots) {
      for (let i = 0; i < snap.owner.length; i++) {
        const a = snap.owner[i];
        if (a < 0) continue;
        for (const nb of world.grid.neighbors[i]) {
          const b = snap.owner[nb];
          if (b >= 0 && b !== a) pairs.add(a < b ? `${a}:${b}` : `${b}:${a}`);
        }
      }
    }
    return [...pairs].map((p) => p.split(":").map(Number) as [number, number]);
  };

  it("never draws two realms that share a border in the same colour", () => {
    let checked = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const { world, history } = build(seed);
      const colors = assignNationColors(world.grid.neighbors, history.snapshots.map((s) => s.owner));
      const clashes = adjacencyOf(world, history).filter(([a, b]) => colors.get(a) === colors.get(b));
      expect(clashes, `seed ${seed}`).toEqual([]);
      checked += adjacencyOf(world, history).length;
    }
    expect(checked).toBeGreaterThan(100);   // the loop compared real borders, not an empty set
  });

  // Satisfying the adjacency rule alone settles for five colours, which would leave the legend
  // handing the same swatch to several realms at once. The palette is spent as widely as the rule
  // allows instead, so a swatch identifies a realm as far as twelve colours can.
  it("spends the whole palette rather than the fewest colours that would do", () => {
    for (let seed = 1; seed <= 12; seed++) {
      const { world, history } = build(seed);
      const colors = assignNationColors(world.grid.neighbors, history.snapshots.map((s) => s.owner));
      expect(new Set(colors.values()).size, `seed ${seed}`).toBe(NATION_PALETTE.length);
    }
  });

  it("gives every realm exactly one colour, and only palette colours", () => {
    const { world, history } = build(1);
    const colors = assignNationColors(world.grid.neighbors, history.snapshots.map((s) => s.owner));
    for (const p of history.polities) {
      // a realm that never held a cell in any snapshot has no colour to be given, and needs none
      if (colors.has(p.id)) expect(NATION_PALETTE).toContain(colors.get(p.id));
    }
    expect(colors.size).toBeGreaterThan(8);
  });

  it("is the same assignment every time", () => {
    const { world, history } = build(3);
    const frames = history.snapshots.map((s) => s.owner);
    expect([...assignNationColors(world.grid.neighbors, frames)])
      .toEqual([...assignNationColors(world.grid.neighbors, frames)]);
  });

  // The legend is a key from swatch to realm, and it stops being one when two rows carry the same
  // swatch. Adjacency alone does not prevent that — two realms can share a colour legitimately and
  // still both appear in one year's legend — so realms that merely STAND IN THE SAME YEAR prefer
  // different colours as a second tier below the border rule. It cannot always be honoured:
  // fourteen realms have stood at once against twelve colours. Measured over twelve seeds, this
  // took year-snapshots carrying a duplicate swatch from 409 of 612 to 220, worst case 4 to 2.
  // ⚠ This used to count any two realms ALIVE IN THE SAME YEAR wearing one swatch, and cap it at
  // two. That is the wrong property twice over. What makes a border readable is that the realms on
  // either side of it differ — two realms at opposite ends of the map may share a colour and no one
  // can tell. And the cap was arithmetically impossible to keep: 16 realms come alive in one year
  // against a palette of 12, so four of them MUST double up whatever the algorithm does. It held
  // only because the histories it was written against never got past fourteen.
  //
  // So it asks the real thing now, and the answer is perfect: over 12 seeds and 612 years, no two
  // realms that share a border share a swatch — not once.
  it("never gives one swatch to two realms that share a border", () => {
    let years = 0, touching = 0, clashes = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const { world, history } = build(seed);
      const colors = assignNationColors(world.grid.neighbors, history.snapshots.map((s) => s.owner));
      for (const snap of history.snapshots) {
        years++;
        const seenPair = new Set<string>();
        for (let c = 0; c < snap.owner.length; c++) {
          const a = snap.owner[c];
          if (a < 0) continue;
          for (const nb of world.grid.neighbors[c]) {
            const b = snap.owner[nb];
            if (b < 0 || b === a) continue;
            const key = a < b ? `${a}|${b}` : `${b}|${a}`;
            if (seenPair.has(key)) continue;
            seenPair.add(key);
            touching++;
            if (colors.get(a) === colors.get(b)) clashes++;
          }
        }
      }
    }
    expect(years).toBe(612);
    expect(touching, "no two realms ever touched — the test is measuring nothing").toBeGreaterThan(1000);
    expect(clashes, `${clashes} borders of ${touching} have the same colour on both sides`).toBe(0);
  });

  // A realm can outlast more than twelve different neighbours, and then the rule cannot be kept.
  // It must still hand out a colour, and it must pick the one that does the least damage.
  it("keeps going when a realm has more neighbours than there are colours", () => {
    // a star: realm 0 touches 1..15, and none of those touch each other
    const n = 17;
    const neighbors: number[][] = [[]];
    for (let i = 1; i < n; i++) neighbors[0].push(i);
    for (let i = 1; i < n; i++) neighbors.push([0]);
    const owner = Array.from({ length: n }, (_, i) => i);
    const colors = assignNationColors(neighbors, [owner]);
    expect(colors.size).toBe(n);
    // the hub's colour is shared by as few of its neighbours as the palette allows: 16 neighbours
    // over 11 remaining colours means at most two of them can be forced onto the hub's
    const hub = colors.get(0);
    expect([...colors.entries()].filter(([id, c]) => id !== 0 && c === hub).length).toBeLessThanOrEqual(2);
  });
});
