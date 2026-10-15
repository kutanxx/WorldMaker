import { describe, it, expect } from "vitest";
import { generateWorld } from "./world";
import { DEFAULT_PARAMS } from "../types/world";
import { generateCityLayout, cityContext, isHamlet } from "./city";

// ★ A hamlet of 150–400 people was drawn with a capital's kit: over twelve worlds, all 72 size-1 towns
// had a stone wall with towers, a cathedral, a guildhall and 8–12 wards of slums, barracks and parks
// (plate review, 2026-10-15) — the facts beside the plate said "촌락" and the plate said otherwise. A
// hamlet is its houses round a green with a parish church, and its lanes run out where they run out.
const HAMLET = 1;
const towns = (seed: number) => {
  const { world } = generateWorld({ ...DEFAULT_PARAMS, seed });
  return world.cities.map((c) => ({ c, l: generateCityLayout(cityContext(c), seed) }));
};

describe("a hamlet is not a walled town", () => {
  const all = [1, 2, 3].flatMap(towns);
  // (a realm's seat is no hamlet whatever its size; the world seats its realms in towns of 3 and up)
  const hamlets = all.filter(({ c }) => c.size === HAMLET && !c.isCapital);
  const towns2 = all.filter(({ c }) => c.size > HAMLET || c.isCapital);

  it("has hamlets to speak of, and towns", () => {
    expect(hamlets.length).toBeGreaterThan(5);
    expect(towns2.length).toBeGreaterThan(20);
  });

  it("stands with no wall, no moat, no gate and no gate-work", () => {
    for (const { c, l } of hamlets) {
      const where = `${c.name} (size ${c.size})`;
      expect(l.wall, `${where} is walled`).toBeNull();
      expect(l.moat, `${where} has a moat`).toBeNull();
      expect(l.gateBridges, `${where} has gate bridges`).toEqual([]);
      expect(l.barbicans, `${where} has a barbican`).toEqual([]);
      expect(l.castle, `${where} has a castle`).toBeNull();
    }
  });

  it("has a green and houses, a parish church instead of a cathedral, and no guild, barracks or slum", () => {
    for (const { c, l } of hamlets) {
      const where = c.name;
      const types = new Set(l.wards.map((w) => w.type));
      expect(types.has("plaza"), `${where} has no green`).toBe(true);
      for (const t of ["cathedral", "guildhall", "market", "slum", "military", "merchant", "patriciate", "castle"]) {
        expect(types.has(t as never), `${where} has a ${t} ward`).toBe(false);
      }
      expect(l.landmarks, `${where} has a great building`).toEqual([]);
      expect(l.parishChurches.length, `${where}'s churches`).toBe(1);
      // only the green is named on the plan (and the harbour, where the hamlet is a port; and its one common,
      // where it has one — a quarter is named where the town has exactly one of it)
      for (const lb of l.labels) expect(["plaza", "harbor", "park"], `${where} names its ${lb.type}`).toContain(lb.type);
    }
  });

  it("still sends its lanes out to the world's roads", () => {
    const onRoads = hamlets.filter(({ c }) => (c.roads?.length ?? 0) > 0);
    expect(onRoads.length).toBeGreaterThan(0);
    for (const { c, l } of onRoads) expect(l.suburbRoads.length, `${c.name} has no way out`).toBeGreaterThan(0);
  });

  it("leaves every larger town its wall", () => {
    for (const { c, l } of towns2) expect(l.wall, `${c.name} (size ${c.size}) lost its wall`).not.toBeNull();
  });

  // the plate's words (its kind, its green, its houses) tell a hamlet from a town by its layout alone — the
  // layout carries no flag of its own, so that the plates' bytes stay where they are
  it("is known for one by its layout", () => {
    for (const { c, l } of hamlets) expect(isHamlet(l), `${c.name} does not read as a hamlet`).toBe(true);
    for (const { c, l } of towns2) expect(isHamlet(l), `${c.name} (size ${c.size}) reads as a hamlet`).toBe(false);
  });
});
