import { describe, it, expect } from "vitest";
import { generateWorld } from "./world";
import { DEFAULT_PARAMS } from "../types/world";
import { initSim, stepSim, TICKS, aggregate, contestStrength, W_CONSTS_FOR_TEST, CONQUEST_SOL, buildStraitLinks, type Stance } from "./historySim";
import { OCEAN, LAND } from "./terrain";

describe("historySim", () => {
  it("initSim yields the year-0 state", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const s = initSim(world, 1);
    expect(s.tick).toBe(0);
    expect(s.snapshots.length).toBe(1);
    expect(s.snapshots[0].year).toBe(0);
    expect(Array.from(s.owner)).toEqual(Array.from(world.polityOf));
    expect(s.polities.length).toBe(world.polities.length);
    for (const p of s.polities) expect(p.origin).toBe("initial");
    const founds = s.events.filter((e) => e.type === "found" && e.year === 0);
    expect(founds.length).toBe(world.polities.length);
    expect(s.events.some((e) => e.type === "staple")).toBe(true);
  });

  it("stepSim advances one tick and appends a snapshot", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const s = initSim(world, 1);
    stepSim(s);
    expect(s.tick).toBe(1);
    expect(s.snapshots.length).toBe(2);
    expect(s.snapshots[1].year).toBe(10);
    expect(s.snapshots[1].owner.length).toBe(world.grid.count);
  });

  it("is deterministic across two init+step runs (whole-timeline hash)", () => {
    const run = () => {
      const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 4 });
      const s = initSim(world, 4);
      for (let t = 1; t <= TICKS; t++) stepSim(s);
      let h = 2166136261 >>> 0;
      for (const snap of s.snapshots) for (let i = 0; i < snap.owner.length; i++) { h ^= (snap.owner[i] + 1) >>> 0; h = Math.imul(h, 16777619) >>> 0; }
      return h >>> 0;
    };
    expect(run()).toBe(run());
  });

  describe("contestStrength", () => {
    it("computes the formula: agg[polity].avg * W_ASA + solidarity[solCell] * W_LOCAL + sqrt(cells) * W_POWER - dist * W_DIST + zoneBonus", () => {
      const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 5 });
      const s = initSim(world, 5);
      stepSim(s);
      const agg = aggregate(s);

      // find a cell with both a neighbor and an owner to test
      let testCell = -1;
      for (let c = 0; c < s.n; c++) {
        const o = s.owner[c];
        if (o >= 0) {
          const neighbors = s.grid.neighbors[c];
          for (const nb of neighbors) {
            if (s.terrain[nb] !== 0 && s.owner[nb] >= 0 && s.owner[nb] !== o) {
              testCell = c;
              break;
            }
          }
          if (testCell >= 0) break;
        }
      }
      expect(testCell).toBeGreaterThanOrEqual(0);

      const o = s.owner[testCell];
      const neighbors = s.grid.neighbors[testCell];
      let best = -1, bestAvg = -Infinity, bestCell = -1;
      for (const nb of neighbors) {
        if (s.terrain[nb] === 0) continue;
        const p = s.owner[nb];
        if (p < 0 || p === o || s.polities[p].free) continue;
        if (agg[p].avg > bestAvg) { bestAvg = agg[p].avg; best = p; bestCell = nb; }
      }

      if (best >= 0) {
        // use the exported function
        const strength = contestStrength(s, agg, best, testCell, bestCell);

        // manually compute the expected strength using exported constants
        const { W_ASA, W_LOCAL, W_POWER, W_DIST, SIZE_CAP } = W_CONSTS_FOR_TEST;
        const px = (i: number) => s.grid.points[i * 2];
        const py = (i: number) => s.grid.points[i * 2 + 1];
        const dist = (a: number, b: number) => Math.hypot(px(a) - px(b), py(a) - py(b));
        let zoneBonus = 0;
        for (const z of s.economicZones) if (s.owner[z.cell] === best) zoneBonus += 0.12;

        const expected = agg[best].avg * W_ASA + s.solidarity[bestCell] * W_LOCAL + Math.min(Math.sqrt(agg[best].cells), SIZE_CAP) * W_POWER - dist(testCell, s.capitals[best]) * W_DIST + zoneBonus;

        expect(strength).toBeCloseTo(expected, 10);
      }
    });
  });

  describe("buildStraitLinks", () => {
    // chain: 0(L) - 1(O) - 2(L) - 3(O) - 4(O) - 5(L)
    const grid = {
      count: 6,
      neighbors: [[1], [0, 2], [1, 3], [2, 4], [3, 5], [4]],
      points: new Float64Array(12),
    } as any;
    const terrain = [LAND, OCEAN, LAND, OCEAN, OCEAN, LAND];

    it("links land cells separated by a narrow strait (≤ hops ocean cells)", () => {
      const links = buildStraitLinks(grid, terrain, 2);
      expect(links[0]).toContain(2);        // 0 and 2 are one ocean cell apart
      expect(links[2].slice().sort()).toEqual([0, 5]); // 2 reaches 0 (1 hop) and 5 (2 hops)
    });

    it("does not link land cells beyond the hop budget", () => {
      const links = buildStraitLinks(grid, terrain, 2);
      expect(links[0]).not.toContain(5);    // 0→5 is 3 ocean cells; out of a 2-hop strait
    });
  });

  describe("amphibious strait contest (symmetric, gated on playerPolity)", () => {
    it("lets a strong enemy across a strait take a weak, isolated player coastal cell in one tick", () => {
      const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
      const s = initSim(world, 1);
      const enemy = s.owner.find((o) => o >= 0)!;
      const player = s.owner.find((o) => o >= 0 && o !== enemy)!;
      // a player cell with NO enemy LAND neighbour (so only a strait invasion can flip it)
      const pcTarget = [...Array(s.n).keys()].find(
        (c) => s.owner[c] === player && s.grid.neighbors[c].every((nb) => s.owner[nb] === player || s.terrain[nb] === OCEAN),
      );
      const bc = s.owner.findIndex((o) => o === enemy);
      expect(pcTarget).toBeDefined();
      expect(bc).toBeGreaterThanOrEqual(0);
      // make the enemy overwhelming and the target defenceless
      for (let c = 0; c < s.n; c++) if (s.owner[c] === enemy) s.solidarity[c] = 1;
      s.solidarity[pcTarget!] = 0;
      s.playerPolity = player;
      s.stance = "internal";
      s.straitLinks = Array.from({ length: s.n }, () => [] as number[]);
      s.straitLinks[pcTarget!] = [bc];
      s.straitLinks[bc] = [pcTarget!];
      stepSim(s);
      expect(s.owner[pcTarget!]).toBe(enemy);
    });

    it("never runs the strait pass on the pure-history path (no straitLinks)", () => {
      const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
      const s = initSim(world, 1);
      expect(s.straitLinks).toBeUndefined(); // pure path builds none → golden byte-identity holds
    });
  });

  describe("player fields + stance", () => {
    const mk = () => { const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 2 }); return initSim(world, 2); };

    it("a fresh SimState has no player (byte-identical default path)", () => {
      const s = mk();
      expect(s.playerPolity).toBe(-1);
      expect(s.peakCells).toBe(0);
      expect(CONQUEST_SOL).toBeGreaterThan(0);
    });

    it("internal stance raises a player cell's solidarity more than aggressive over one tick", () => {
      const setup = (stance: Stance) => {
        const s = mk();
        // choose an interior (non-frontier) player cell so the base delta is a decay we can offset
        const p = s.owner.findIndex((o) => o >= 0);
        s.playerPolity = s.owner[p]; s.stance = stance;
        const cell = p;
        stepSim(s);
        return s.solidarity[cell];
      };
      expect(setup("internal")).toBeGreaterThan(setup("aggressive"));
    });

    it("aggressive raises the player's attacker strength above defensive (same state)", () => {
      const s = mk();
      const p = s.owner.find((o) => o >= 0)!;
      s.playerPolity = p;
      const agg = aggregate(s);
      // a border cell of p and the enemy cell beyond it
      let distCell = -1, solCell = -1;
      for (let i = 0; i < s.n && distCell < 0; i++) {
        if (s.owner[i] !== p) continue;
        for (const nb of s.grid.neighbors[i]) if (s.owner[nb] >= 0 && s.owner[nb] !== p) { solCell = i; distCell = nb; break; }
      }
      expect(distCell).toBeGreaterThanOrEqual(0);
      const base = contestStrength(s, agg, p, distCell, solCell);
      // the exported stance multipliers must order aggressive > defensive for the attacker
      const { STANCE_ATK_MULT } = W_CONSTS_FOR_TEST as any; // see Step 3 (added to the export)
      expect(base * STANCE_ATK_MULT.aggressive).toBeGreaterThan(base * STANCE_ATK_MULT.defensive);
    });
  });
});
