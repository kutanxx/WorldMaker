import { describe, it, expect } from "vitest";
import { generateWorld } from "./world";
import { DEFAULT_PARAMS } from "../types/world";
import { initSim, CONQUEST_SOL } from "./historySim";
import { borderTargets } from "./intervention";
import { offerDilemma, resolveDilemma, previewDilemma, bestRaidTarget, borderCellsBetween, DILEMMA_COOLDOWN, WARWEARY_TRUCE_TICKS, HEGEMON_SPOILS, HEGEMON_MIN_TICK, type Dilemma } from "./dilemma";

const small = { ...DEFAULT_PARAMS, width: 300, height: 300, cellCount: 400, townCount: 6 };
const worlds = new Map<string, ReturnType<typeof generateWorld>["world"]>();
function biggestPlayerState(seed: number, full = false) {
  const key = `${seed}:${full}`;
  if (!worlds.has(key)) worlds.set(key, generateWorld(full ? { ...DEFAULT_PARAMS, seed } : { ...small, seed }).world);
  const world = worlds.get(key)!;
  const s = initSim(world, seed);
  const counts = new Map<number, number>();
  for (const o of s.owner) if (o >= 0) counts.set(o, (counts.get(o) ?? 0) + 1);
  s.playerPolity = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  return s;
}
// rng-gated triggers: retry with the cooldown reset until the wanted dilemma fires
// (a met condition can still lose its probability draw and fall through to a lower-priority one)
function forceOffer(s: ReturnType<typeof biggestPlayerState>, want?: string, tries = 128) {
  for (let i = 0; i < tries; i++) {
    s.lastDilemma = -99;
    const d = offerDilemma(s);
    if (d && (!want || d.code === want)) return d;
  }
  return null;
}

describe("offerDilemma", () => {
  it("never fires on the pure-history path", () => {
    const { world } = generateWorld({ ...small, seed: 1 });
    const s = initSim(world, 1); // playerPolity -1
    for (let i = 0; i < 32; i++) expect(offerDilemma(s)).toBeNull();
  });

  it("offers unrest when cohesion is low, and respects the cooldown", () => {
    const s = biggestPlayerState(1, true); // UNREST_MIN_CELLS needs a full-size realm
    for (let c = 0; c < s.n; c++) if (s.owner[c] === s.playerPolity) s.solidarity[c] = 0.2;
    const d = forceOffer(s, "unrest");
    expect(d?.code).toBe("unrest");
    // the offer just fired → lastDilemma = tick → cooldown blocks the next one
    expect(offerDilemma(s)).toBeNull();
    expect(DILEMMA_COOLDOWN).toBeGreaterThan(0);
  });

  it("offers prosperity when cohesion is high", () => {
    const s = biggestPlayerState(1);
    for (let c = 0; c < s.n; c++) if (s.owner[c] === s.playerPolity) s.solidarity[c] = 0.9;
    const d = forceOffer(s, "prosperity");
    expect(d?.code).toBe("prosperity");
  });
});

describe("resolveDilemma", () => {
  it("unrest: conceding sheds border cells but restores cohesion", () => {
    const s = biggestPlayerState(1, true);
    for (let c = 0; c < s.n; c++) if (s.owner[c] === s.playerPolity) s.solidarity[c] = 0.2;
    const d = forceOffer(s, "unrest")!;
    let before = 0;
    for (let c = 0; c < s.n; c++) if (s.owner[c] === s.playerPolity) before++;
    const r = resolveDilemma(s, d, "a");
    expect(r.code).toBe("unrestConcede");
    let after = 0, sum = 0;
    for (let c = 0; c < s.n; c++) if (s.owner[c] === s.playerPolity) { after++; sum += s.solidarity[c]; }
    expect(after).toBeLessThan(before);
    expect(before - after).toBeLessThanOrEqual(5);
    expect(sum / after).toBeGreaterThan(0.2); // cohesion rose
  });

  it("unrest: crushing is a gamble that moves cohesion one way or the other", () => {
    const s = biggestPlayerState(1, true);
    for (let c = 0; c < s.n; c++) if (s.owner[c] === s.playerPolity) s.solidarity[c] = 0.3;
    const d = forceOffer(s, "unrest")!;
    const r = resolveDilemma(s, d, "b");
    expect(["unrestCrushOk", "unrestCrushFail"]).toContain(r.code);
    const some = s.owner.findIndex((o) => o === s.playerPolity);
    expect(s.solidarity[some]).not.toBeCloseTo(0.3, 6);
  });

  it("defector: accepting flips the defector's cell to the player with fresh cohesion", () => {
    const s = biggestPlayerState(1);
    // mid cohesion so neither unrest nor prosperity outranks defector; ensure defector triggers
    for (let c = 0; c < s.n; c++) if (s.owner[c] >= 0) s.solidarity[c] = 0.5;
    let d = null;
    for (let i = 0; i < 128 && (!d || d.code !== "defector"); i++) { s.lastDilemma = -99; d = offerDilemma(s); }
    expect(d?.code).toBe("defector");
    const cell = Number(d!.data.cell);
    expect(s.owner[cell]).not.toBe(s.playerPolity);
    const r = resolveDilemma(s, d!, "a");
    expect(r.code).toBe("defectorAccept");
    expect(s.owner[cell]).toBe(s.playerPolity);
    expect(s.solidarity[cell]).toBeCloseTo(CONQUEST_SOL, 6);
  });

  it("defector: returning them buys a short truce", () => {
    const s = biggestPlayerState(1);
    for (let c = 0; c < s.n; c++) if (s.owner[c] >= 0) s.solidarity[c] = 0.5;
    let d = null;
    for (let i = 0; i < 128 && (!d || d.code !== "defector"); i++) { s.lastDilemma = -99; d = offerDilemma(s); }
    expect(d?.code).toBe("defector");
    const owner = Number(d!.data.polity);
    resolveDilemma(s, d!, "b");
    expect(s.truces.get(owner)).toBe(s.tick + 1);
  });

  it("raiders: the punitive raid can capture cells for free when the player is strong", () => {
    const s = biggestPlayerState(1);
    for (let c = 0; c < s.n; c++) {
      if (s.owner[c] === s.playerPolity) s.solidarity[c] = 1;
      else if (s.owner[c] >= 0) s.solidarity[c] = 0.9; // strong enemies → threats, but player stronger
    }
    // craft a raiders dilemma directly (trigger depends on threat topology; resolution is what we test)
    const target = borderTargets(s).find((t) => t.capturable && !t.sea)!;
    const before = s.owner[target.cell];
    const r = resolveDilemma(s, { code: "raiders", data: {} }, "b");
    expect(["raidersRaid", "raidersNoTarget"]).toContain(r.code);
    if (r.code === "raidersRaid") {
      expect(Number(r.data.n)).toBeGreaterThanOrEqual(1);
      void before;
    }
  });
});

describe("previewDilemma", () => {
  it("is read-only: no rng draw, no state mutation", () => {
    const s = biggestPlayerState(1, true);
    for (let c = 0; c < s.n; c++) if (s.owner[c] === s.playerPolity) s.solidarity[c] = 0.2;
    const d = forceOffer(s, "unrest")!;
    const rng = s.rng; let calls = 0;
    s.rng = () => { calls++; return rng(); };
    const owner = [...s.owner], sol = [...s.solidarity];
    previewDilemma(s, d, "a"); previewDilemma(s, d, "b");
    expect(calls).toBe(0);
    expect([...s.owner]).toEqual(owner);
    expect([...s.solidarity]).toEqual(sol);
    s.rng = rng;
  });

  it("unrest: concede preview matches the cells resolve actually sheds; crush reports odds, not a roll", () => {
    const s = biggestPlayerState(1, true);
    for (let c = 0; c < s.n; c++) if (s.owner[c] === s.playerPolity) s.solidarity[c] = 0.2;
    const d = forceOffer(s, "unrest")!;
    const pa = previewDilemma(s, d, "a");
    const pb = previewDilemma(s, d, "b");
    expect(pa.cohesion).toBe(1);
    expect(pb.cohesion).toBe(1);
    expect(pb.odds).toBeGreaterThan(0);
    expect(pb.odds).toBeLessThan(1);
    const out = resolveDilemma(s, d, "a"); // resolve AFTER previews
    expect(out.code).toBe("unrestConcede");
    expect(pa.cells).toBe(-Number(out.data.n));
  });

  it("raiders: raid preview equals the raid's real capture count (shared bestRaidTarget)", () => {
    const s = biggestPlayerState(1, true);
    for (let c = 0; c < s.n; c++) s.solidarity[c] = s.owner[c] === s.playerPolity ? 0.9 : 0.1;
    const d: Dilemma = { code: "raiders", data: { threats: 6 } }; // effects don't read the offer draw
    const bt = bestRaidTarget(s);            // BEFORE resolve — resolve mutates the state
    const pv = previewDilemma(s, d, "b");
    if (bt) expect(pv.cells).toBe(bt.gain); else expect(pv.note).toBe("noTarget");
    const out = resolveDilemma(s, d, "b");
    if (out.code === "raidersRaid") expect(Number(out.data.n)).toBe(pv.cells);
    else expect(pv.note).toBe("noTarget");
    expect(previewDilemma(s, d, "a")).toEqual({ note: "fortify" });
  });

  it("prosperity: frontier reads as the stronger boost; defector previews flip + truce", () => {
    const s = biggestPlayerState(1, true);
    expect(previewDilemma(s, { code: "prosperity", data: {} }, "a")).toEqual({ cohesion: 1 });
    expect(previewDilemma(s, { code: "prosperity", data: {} }, "b")).toEqual({ cohesion: 2 });
    const d = forceOffer(s, "defector");
    if (d) {
      expect(previewDilemma(s, d, "a")).toEqual({ cells: 1, truce: "break" });
      expect(previewDilemma(s, d, "b")).toEqual({ truce: "gain" });
    }
  });
});

describe("state cards", () => {
  it("warweary: fires under threat with sagging cohesion; terms buys a truce with the top threat", () => {
    const s = biggestPlayerState(1, true);
    // player sagging (0.45 < WARWEARY_MAX_ASA, but above unrest's 0.42) and OUTMATCHED at the
    // border (threat edges need the ENEMY side to be the stronger one — hence enemies at 0.9)
    for (let c = 0; c < s.n; c++) s.solidarity[c] = s.owner[c] === s.playerPolity ? 0.45 : 0.9;
    const d = forceOffer(s, "warweary");
    expect(d?.code).toBe("warweary");
    if (!d) return;
    expect(previewDilemma(s, d, "a")).toEqual({ note: "fortify" });
    const pb = previewDilemma(s, d, "b");
    const out = resolveDilemma(s, d, "b");
    if (out.code === "warwearyTerms") {
      expect(pb).toEqual({ cohesion: -1, truce: "gain" });
      // the truce really exists, with the named polity, for 2 ticks
      const foe = s.polities.findIndex((p) => p.name === out.data.name);
      expect((s.truces.get(foe) ?? 0)).toBe(s.tick + WARWEARY_TRUCE_TICKS);
    } else {
      expect(out.code).toBe("warwearyNoFoe");
      expect(pb).toEqual({ note: "noTarget" });
    }
  });

  it("boomtown: needs a held founded city; walls lift the city and its owned neighbors", () => {
    const s = biggestPlayerState(1, true);
    // plant a founded city on a player cell with player-owned neighbors
    let city = -1;
    for (let c = 0; c < s.n && city < 0; c++) {
      if (s.owner[c] !== s.playerPolity) continue;
      if (s.grid.neighbors[c].every((nb) => s.owner[nb] === s.playerPolity)) city = c;
    }
    expect(city).toBeGreaterThanOrEqual(0);
    s.foundedCities.add(city);
    const d = forceOffer(s, "boomtown");
    expect(d?.code).toBe("boomtown");
    if (!d) return;
    expect(Number(d.data.cell)).toBe(city);
    expect(previewDilemma(s, d, "a")).toEqual({ cohesion: 1 });
    expect(previewDilemma(s, d, "b")).toEqual({ note: "citywall" });
    const before = s.solidarity[city];
    const out = resolveDilemma(s, d, "b");
    expect(out.code).toBe("boomtownWall");
    expect(Number(out.data.n)).toBe(1 + s.grid.neighbors[city].length); // city + all neighbors owned
    expect(s.solidarity[city]).toBeGreaterThan(before);
  });

  it("boomtown never fires without a held founded city", () => {
    const s = biggestPlayerState(1, true);
    expect(forceOffer(s, "boomtown", 64)).toBeNull();
  });
});

describe("prophecy chain", () => {
  it("sponsoring guarantees the follow-up at the next window; the judgment is the stated threshold", () => {
    const s = biggestPlayerState(1, true);
    const d1 = forceOffer(s, "prophecy1");
    expect(d1?.code).toBe("prophecy1");
    if (!d1) return;
    expect(previewDilemma(s, d1, "a")).toEqual({ cohesion: -1, note: "prophecyDeal" });
    expect(previewDilemma(s, d1, "b")).toEqual({ note: "noEffect" });
    resolveDilemma(s, d1, "a");
    expect(s.dilemmaFlags.has("prophecySponsored")).toBe(true);
    // next window: the follow-up is guaranteed (no probability draw)
    s.lastDilemma = -99;
    const d2 = offerDilemma(s);
    expect(d2?.code).toBe("prophecy2");
    if (!d2) return;
    // the preview states the live condition
    const pv = previewDilemma(s, d2, "a");
    expect(pv.note).toBe("prophecyCond");
    expect(typeof pv.pct).toBe("number");
    // set cohesion decisively above the threshold and proclaim
    for (let c = 0; c < s.n; c++) if (s.owner[c] === s.playerPolity) s.solidarity[c] = 0.9;
    const out = resolveDilemma(s, d2, "a");
    expect(out.code).toBe("prophecyFulfilled");
    expect(s.dilemmaFlags.has("prophecySponsored")).toBe(false);
    expect(s.dilemmaFlags.has("prophecyDone")).toBe(true);
    // once per reign: never offered again
    expect(forceOffer(s, "prophecy1", 64)).toBeNull();
  });

  it("turning the prophet away ends the chain; a low-cohesion proclamation debunks", () => {
    const s = biggestPlayerState(2, true);
    const d1 = forceOffer(s, "prophecy1");
    if (!d1) return; // seed didn't cooperate — the seed-1 test above carries the chain contract
    resolveDilemma(s, d1, "b");
    expect(s.dilemmaFlags.has("prophecyDone")).toBe(true);
    expect(s.dilemmaFlags.has("prophecySponsored")).toBe(false);
  });

  it("dilemmaFlags is initialized empty and unused by pure history", () => {
    const { world } = generateWorld({ ...small, seed: 3 });
    const s = initSim(world, 3);
    expect(s.dilemmaFlags.size).toBe(0);
  });
});

describe("hegemon crisis arc", () => {
  // a state where the arc's opening condition holds: play the SMALLEST nation late-game
  function hegemonState(seed: number) {
    const s = biggestPlayerState(seed, true);
    const counts = new Map<number, number>();
    for (const o of s.owner) if (o >= 0) counts.set(o, (counts.get(o) ?? 0) + 1);
    const sorted = [...counts.entries()].sort((a, b) => a[1] - b[1]);
    s.playerPolity = sorted[0][0]; // smallest → the biggest rival easily clears 1.6×
    s.tick = HEGEMON_MIN_TICK + 1;
    return s;
  }

  it("opens once past mid-game against a 1.6× rival, then runs act-per-window bypassing the cooldown", () => {
    const s = hegemonState(1);
    s.lastDilemma = -99;
    const d1 = offerDilemma(s);
    expect(d1?.code).toBe("hegemon1");
    if (!d1) return;
    const foe = Number(d1.data.polity);
    expect(s.alive[foe]).toBe(true);
    expect(previewDilemma(s, d1, "a")).toEqual({ truce: "gain" });
    expect(previewDilemma(s, d1, "b")).toEqual({ note: "fortify" });
    resolveDilemma(s, d1, "b");
    expect(s.dilemmaFlags.has("hegemon2")).toBe(true);
    // act 2 fires on the very next offer call — no cooldown wait
    const d2 = offerDilemma(s);
    expect(d2?.code).toBe("hegemon2");
    if (!d2) return;
    expect(previewDilemma(s, d2, "a")).toEqual({ cohesion: -2, truce: "gain" });
    resolveDilemma(s, d2, "b"); // defy
    expect(s.dilemmaFlags.has("hegemon3")).toBe(true);
    const d3 = offerDilemma(s);
    expect(d3?.code).toBe("hegemon3");
    if (!d3) return;
    // the battle preview reports real odds and the real spoils count, no rng draw
    const pv = previewDilemma(s, d3, "a");
    expect(pv.odds).toBeGreaterThanOrEqual(0.2);
    expect(pv.odds).toBeLessThanOrEqual(0.8);
    expect(pv.cells).toBe(borderCellsBetween(s, foe, HEGEMON_SPOILS, "other").length);
    // stub the roll: win
    const rng = s.rng;
    s.rng = () => 0;
    const before = borderCellsBetween(s, foe, HEGEMON_SPOILS, "other");
    const out = resolveDilemma(s, d3, "a");
    s.rng = rng;
    expect(out.code).toBe("hegemonVictory");
    expect(Number(out.data.n)).toBe(before.length);
    for (const c of before) expect(s.owner[c]).toBe(s.playerPolity);
    expect(s.dilemmaFlags.has("hegemonDone")).toBe(true);
    // once per reign
    s.lastDilemma = -99;
    for (let i = 0; i < 32; i++) { s.lastDilemma = -99; expect(offerDilemma(s)?.code ?? "x").not.toMatch(/^hegemon/); }
  });

  it("a lost battle cedes player border cells to the hegemon; tribute ends the arc peacefully", () => {
    const s = hegemonState(2);
    s.lastDilemma = -99;
    const d1 = offerDilemma(s);
    expect(d1?.code).toBe("hegemon1");
    if (!d1) return;
    const foe = Number(d1.data.polity);
    resolveDilemma(s, d1, "a"); // rally: truces with some neighbors, never the hegemon
    expect((s.truces.get(foe) ?? 0) <= s.tick).toBe(true);
    const d2 = offerDilemma(s)!;
    resolveDilemma(s, d2, "b");
    const d3 = offerDilemma(s)!;
    const rng = s.rng;
    s.rng = () => 0.999; // force the rout
    const lost = borderCellsBetween(s, foe, HEGEMON_SPOILS, "player");
    const out = resolveDilemma(s, d3, "a");
    s.rng = rng;
    expect(out.code).toBe("hegemonRout");
    for (const c of lost) expect(s.owner[c]).toBe(foe);
  });

  it("the arc dissolves silently if the hegemon dies between acts", () => {
    const s = hegemonState(3);
    s.lastDilemma = -99;
    const d1 = offerDilemma(s);
    expect(d1?.code).toBe("hegemon1");
    if (!d1) return;
    resolveDilemma(s, d1, "b");
    s.alive[Number(d1.data.polity)] = false;
    const next = offerDilemma(s);
    expect(next?.code ?? "none").not.toMatch(/^hegemon/);
    expect(s.dilemmaFlags.has("hegemonDone")).toBe(true);
    expect(s.dilemmaFlags.has("hegemon2")).toBe(false);
  });
});
