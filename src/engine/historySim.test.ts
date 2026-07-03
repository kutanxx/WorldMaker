import { describe, it, expect } from "vitest";
import { generateWorld } from "./world";
import { DEFAULT_PARAMS } from "../types/world";
import { initSim, stepSim, TICKS } from "./historySim";

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
});
