import { describe, it, expect } from "vitest";
import { generateWorld } from "./world";
import { DEFAULT_PARAMS } from "../types/world";
import { initSim, CONQUEST_SOL } from "./historySim";
import { borderTargets } from "./intervention";
import { offerDilemma, resolveDilemma, previewDilemma, bestRaidTarget, DILEMMA_COOLDOWN, type Dilemma } from "./dilemma";

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
