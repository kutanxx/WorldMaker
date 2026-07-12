import { describe, it, expect } from "vitest";
import { generateWorld } from "./world";
import { DEFAULT_PARAMS } from "../types/world";
import { initPlaySim, playTurn, playerCells, scorecard, setStance, victoryProgress, PROSPER_CITIES, PROSPER_COH, PROSPER_STREAK } from "./playSim";
import { applyIntervention, foundCityTargets } from "./intervention";

const small = { ...DEFAULT_PARAMS, width: 300, height: 300, cellCount: 400, townCount: 6 };

describe("playSim", () => {
  it("initPlaySim sets the player fields and seeds peakCells", () => {
    const { world } = generateWorld({ ...small, seed: 1 });
    const s = initPlaySim(world, 1, 0, "internal");
    expect(s.playerPolity).toBe(0);
    expect(s.stance).toBe("internal");
    expect(s.peakCells).toBe(playerCells(s));
    expect(s.peakCells).toBeGreaterThan(0);
  });

  it("playTurn with no action advances one tick (10 years) and reports the year", () => {
    const { world } = generateWorld({ ...small, seed: 1 });
    const s = initPlaySim(world, 1, 0, "internal");
    const r = playTurn(s, null);
    expect(r.year).toBe(10);
    expect(r.defeated).toBe(false);
    expect(s.tick).toBe(1);
  });

  it("reports defeat when the player's capital is conquered", () => {
    const { world } = generateWorld({ ...small, seed: 1 });
    const s = initPlaySim(world, 1, 0, "internal");
    // force an enemy onto the player's capital cell, then step → conquest eliminates polity 0
    const cap = s.capitals[0];
    const enemy = s.polities.findIndex((_, i) => i !== 0);
    for (const nb of s.grid.neighbors[cap]) s.owner[nb] = enemy;
    s.owner[cap] = enemy;                 // seat already lost
    const r = playTurn(s, null);
    expect(r.defeated).toBe(true);
  });

  it("the last snapshot mirrors the live owner array after playTurn (replay's 'present' frame is real)", () => {
    // full-size world, per this file's convention for tests that lean on realistic sim behaviour
    // (see "scorecard counts founded cities" below) — stepSim pushes a snapshot every tick, and
    // the play UI's replay bar treats the final snapshot as standing in for the live map.
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const s = initPlaySim(world, 1, 0, "internal");
    for (let i = 0; i < 5; i++) playTurn(s, null);
    expect(Array.from(s.snapshots[s.snapshots.length - 1].owner)).toEqual(Array.from(s.owner));
  });

  it("setStance changes the stance for free", () => {
    const { world } = generateWorld({ ...small, seed: 1 });
    const s = initPlaySim(world, 1, 0, "internal");
    setStance(s, "aggressive");
    expect(s.stance).toBe("aggressive");
  });

  it("scorecard ranks the player among living nations", () => {
    const { world } = generateWorld({ ...small, seed: 1 });
    const s = initPlaySim(world, 1, 0, "internal");
    const sc = scorecard(s);
    expect(sc.cells).toBeGreaterThan(0);
    expect(sc.rank).toBeGreaterThanOrEqual(1);
    expect(sc.rank).toBeLessThanOrEqual(sc.nations);
  });

  it("scorecard reports a defeated player as unranked (rank 0), not mis-ranked past the nation count", () => {
    const { world } = generateWorld({ ...small, seed: 1 });
    const s = initPlaySim(world, 1, 0, "internal");
    const cap = s.capitals[0];
    const enemy = s.polities.findIndex((_, i) => i !== 0);
    for (const nb of s.grid.neighbors[cap]) s.owner[nb] = enemy;
    s.owner[cap] = enemy;
    const r = playTurn(s, null);
    expect(r.defeated).toBe(true);
    const sc = scorecard(s);
    expect(sc.alive).toBe(false);
    expect(sc.rank).toBe(0);                        // 0 = unranked (was 1 + living-nation count → "7 of 6")
    expect(sc.rank).toBeLessThanOrEqual(sc.nations);
  });

  it("scorecard counts founded cities, held vs lost", () => {
    // full-size world: CITY_MIN_GAP leaves no viable sites on the 300×300 test world
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
    const counts = new Map<number, number>();
    for (const o of world.polityOf) if (o >= 0) counts.set(o, (counts.get(o) ?? 0) + 1);
    const largest = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const s = initPlaySim(world, 1, largest, "internal");
    const t = foundCityTargets(s)[0];
    expect(t).toBeTruthy();
    applyIntervention(s, { type: "foundCity", cell: t.cell });
    let sc = scorecard(s);
    expect(sc.citiesFounded).toBe(1);
    expect(sc.citiesHeld).toBe(1);
    const other = s.polities.find((p) => p.id !== s.playerPolity)!;
    s.owner[t.cell] = other.id; // captured
    sc = scorecard(s);
    expect(sc.citiesFounded).toBe(1);
    expect(sc.citiesHeld).toBe(0);
  });

  it("defeat coincides EXACTLY with losing the capital cell (locks the civil-war-keeps-seat invariant)", () => {
    // pick the largest polity so a civil war of the player's realm is likely over the full game
    const { world } = generateWorld({ ...small, seed: 3 });
    const counts = new Map<number, number>();
    for (const o of world.polityOf) if (o >= 0) counts.set(o, (counts.get(o) ?? 0) + 1);
    const largest = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const s = initPlaySim(world, 3, largest, "aggressive");
    for (let t = 0; t < 50; t++) {
      const r = playTurn(s, null);
      // The ONLY way to be defeated is for the seat cell to leave the player's hands (conquest). A
      // civil war of the player keeps the old capital with the original polity id, so it never
      // defeats — if that invariant ever broke, this equality would fail.
      expect(r.defeated).toBe(s.owner[s.capitals[s.playerPolity]] !== s.playerPolity);
      if (r.finished) break;
    }
  });
});

describe("victoryProgress", () => {
  const small = { ...DEFAULT_PARAMS, width: 300, height: 300, cellCount: 400, townCount: 6 };
  function playerCellsList(s: ReturnType<typeof initPlaySim>): number[] {
    const cells: number[] = [];
    for (let c = 0; c < s.n; c++) if (s.owner[c] === s.playerPolity) cells.push(c);
    return cells;
  }

  it("exports the measurement-seeded constants", () => {
    expect(PROSPER_CITIES).toBe(6);
    expect(PROSPER_COH).toBe(0.55);
    expect(PROSPER_STREAK).toBe(3);
  });

  it("conquest is true only when every initial rival is dead (and there was >=1)", () => {
    const { world } = generateWorld({ ...small, seed: 1 });
    const s = initPlaySim(world, 1, 0, "internal");
    expect(victoryProgress(s).conquest).toBe(false); // rivals alive at start
    expect(victoryProgress(s).initialRivals).toBeGreaterThan(0);
    for (let o = 0; o < s.polities.length; o++) {
      if (o !== s.playerPolity && s.polities[o].origin === "initial") s.alive[o] = false;
    }
    expect(victoryProgress(s).rivalsLeft).toBe(0);
    expect(victoryProgress(s).conquest).toBe(true);
  });

  it("conquest stays false in a player-only world (initialRivals === 0 guard)", () => {
    const { world } = generateWorld({ ...small, seed: 1 });
    const s = initPlaySim(world, 1, 0, "internal");
    // make the player the only original nation: no other polity counts as an initial rival
    for (let o = 0; o < s.polities.length; o++) {
      if (o !== s.playerPolity) s.polities[o].origin = "fragment";
    }
    const vp = victoryProgress(s);
    expect(vp.initialRivals).toBe(0);
    expect(vp.rivalsLeft).toBe(0);
    expect(vp.conquest).toBe(false); // guard: no rivals to conquer => not a conquest win
  });

  it("prosperityGate needs >=PROSPER_CITIES held cities AND cohesion >= PROSPER_COH", () => {
    const { world } = generateWorld({ ...small, seed: 1 });
    const s = initPlaySim(world, 1, 0, "internal");
    const mine = playerCellsList(s);
    for (const c of mine) s.solidarity[c] = 0.7;              // cohesion high
    for (let i = 0; i < PROSPER_CITIES; i++) s.foundedCities.add(mine[i]); // 6 held cities
    expect(victoryProgress(s).prosperityGate).toBe(true);
    s.foundedCities.delete(mine[0]);                          // now only 5
    expect(victoryProgress(s).prosperityGate).toBe(false);
    s.foundedCities.add(mine[0]);
    for (const c of mine) s.solidarity[c] = 0.3;              // cohesion too low
    expect(victoryProgress(s).cohesionOk).toBe(false);
    expect(victoryProgress(s).prosperityGate).toBe(false);
  });
});
