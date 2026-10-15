import { describe, it, expect } from "vitest";
import { generateWorld } from "./world";
import { DEFAULT_PARAMS } from "../types/world";
import { generateCityLayout, cityContext, kitOf, isHamlet } from "./city";

// ★ A village of 400–1,200 people (size 2 — 94 of twelve worlds' 336 towns) was drawn with a capital's kit:
// a stone wall with nineteen towers on average and a barbican, a moat on 52 of them, a cathedral and a
// guildhall on every one, slums on 88 (plate census, 2026-10-15). The user chose a palisade and a parish
// church. A village stands behind a fence with gates — no tower, no moat, no gate-work — and is its houses
// round a green with the one church; it is nobody's seat, and keeps a castle only where it is the fortress
// on the height.
const VILLAGE = 2;
const towns = (seed: number) => {
  const { world } = generateWorld({ ...DEFAULT_PARAMS, seed });
  return world.cities.map((c) => ({ c, l: generateCityLayout(cityContext(c), seed) }));
};

describe("a village is palisaded, not walled", () => {
  const all = [1, 2, 3].flatMap(towns);
  const villages = all.filter(({ c }) => c.size === VILLAGE && !c.isCapital);
  const hamlets = all.filter(({ c }) => c.size < VILLAGE && !c.isCapital);
  const bigger = all.filter(({ c }) => c.size > VILLAGE || c.isCapital);

  it("has villages to speak of, and towns", () => {
    expect(villages.length).toBeGreaterThan(5);
    expect(bigger.length).toBeGreaterThan(20);
  });

  it("stands behind a palisade with gates — no tower, no moat, no gate-work", () => {
    for (const { c, l } of villages) {
      const where = `${c.name} (size ${c.size})`;
      expect(l.wall, `${where} has no fence`).not.toBeNull();
      expect(l.wall!.palisade, `${where} is walled in stone`).toBe(true);
      expect(l.wall!.segments.length, `${where}'s fence`).toBeGreaterThan(0);
      expect(l.wall!.towers, `${where} has towers`).toEqual([]);
      expect(l.wall!.gates.length, `${where} has no gate`).toBeGreaterThan(0);
      expect(l.moat, `${where} has a moat`).toBeNull();
      expect(l.gateBridges, `${where} has gate bridges`).toEqual([]);
      expect(l.barbicans, `${where} has a barbican`).toEqual([]);
      if (l.archetype.id !== "hilltopFortress") expect(l.castle, `${where} has a castle`).toBeNull();
    }
  });

  it("is houses round a green with one parish church — no cathedral, guildhall, market, slum or barracks", () => {
    for (const { c, l } of villages) {
      const types = new Set(l.wards.map((w) => w.type));
      expect(types.has("plaza"), `${c.name} has no green`).toBe(true);
      for (const t of ["cathedral", "guildhall", "market", "slum", "military", "merchant", "patriciate"]) {
        expect(types.has(t as never), `${c.name} has a ${t} ward`).toBe(false);
      }
      expect(l.landmarks, `${c.name} has a great building`).toEqual([]);
      expect(l.parishChurches.length, `${c.name}'s churches`).toBe(1);
    }
  });

  // the plate's words read the kit off the layout alone (no flag of its own on a hamlet, so that its bytes
  // stay; the village's fence carries its own mark)
  it("is known for one by its layout, as a hamlet and a town are for theirs", () => {
    for (const { c, l } of villages) {
      expect(kitOf(l), c.name).toBe("village");
      expect(isHamlet(l), c.name).toBe(false);
    }
    for (const { c, l } of hamlets) expect(kitOf(l), c.name).toBe("hamlet");
    for (const { c, l } of bigger) expect(kitOf(l), `${c.name} (size ${c.size})`).toBe("town");
  });

  it("leaves every larger town its wall and its towers", () => {
    for (const { c, l } of bigger) {
      const where = `${c.name} (size ${c.size})`;
      expect(l.wall, `${where} lost its wall`).not.toBeNull();
      expect(l.wall!.palisade, `${where} is palisaded`).toBeUndefined();
      expect(l.wall!.towers.length, `${where} lost its towers`).toBeGreaterThan(0);
    }
  });
});
