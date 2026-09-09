import { describe, it, expect } from "vitest";
import { cityFacts, POPULATION_BANDS } from "./cityFacts";
import { generateWorld } from "../engine/world";
import { simulateHistory } from "../engine/history";
import { generateCityLayout, cityContext } from "../engine/city";
import { DEFAULT_PARAMS } from "../types/world";
import { KM_PER_UNIT } from "./scaleBar";

// A plate carried its name and nothing else — no realm, no size, no sense of what kind of place it
// was, and no way to get from it to the town next door. An outside review asked for all of that and
// for a founding year "already in the chronicle": measured on seed 1, the simulation raises 19
// newCity events and none of them names a town that appears on the map, so the year is not
// available and is not invented here.
describe("what a plate can say about its town", () => {
  const world = generateWorld({ ...DEFAULT_PARAMS, seed: 1 }).world;
  const facts = (i: number) => {
    const c = world.cities[i];
    return cityFacts(world, c, generateCityLayout(cityContext(c), 1), "en", KM_PER_UNIT);
  };

  it("says whose it is, what it is, and how big", () => {
    for (let i = 0; i < world.cities.length; i++) {
      const f = facts(i);
      expect(f.name).toBe(world.cities[i].name);
      expect(f.kind, `city ${i} has no kind`).not.toMatch(/^kind_/);   // an untranslated key
      expect(f.rank, `city ${i} has no rank`).not.toMatch(/^rank/);
      expect(f.population).toMatch(/^[\d,]+–[\d,]+$/);
    }
    // a capital is in somebody's realm by construction
    expect(facts(0).realm).not.toBeNull();
  });

  it("ranks bigger towns as bigger, with the bands medieval Europe had", () => {
    for (let s = 1; s < 6; s++) {
      expect(POPULATION_BANDS[s][1], `band ${s} does not lead into ${s + 1}`).toBeLessThanOrEqual(POPULATION_BANDS[s + 1][0]);
      expect(POPULATION_BANDS[s][0]).toBeLessThan(POPULATION_BANDS[s][1]);
    }
    expect(POPULATION_BANDS[1][0]).toBeLessThan(500);      // a hamlet
    expect(POPULATION_BANDS[6][1]).toBeLessThan(100000);   // and not a modern city
  });

  it("points at the towns next door, nearest first, in walking distance", () => {
    const f = facts(0);
    expect(f.neighbours.length).toBe(3);
    for (let i = 1; i < f.neighbours.length; i++) expect(f.neighbours[i].km).toBeGreaterThanOrEqual(f.neighbours[i - 1].km);
    for (const n of f.neighbours) {
      expect(n.id).not.toBe(world.cities[0].id);
      expect(world.cities.some((c) => c.id === n.id && c.name === n.name)).toBe(true);
      expect(n.km).toBeGreaterThan(0);
    }
  });
});

// The founding year was left out when this was written, because the chronicle founded towns that
// were not on the map. That was fixed at the source, so the year is available — for the towns the
// chronicle founds. A capital is a seat the world starts with; a town the five centuries never got
// round to predates the record. Both say so rather than inventing a number.
describe("when a town came to be", () => {
  it("gives the chronicle's year to the towns it founded, and nothing to the rest", () => {
    const w = generateWorld({ ...DEFAULT_PARAMS, seed: 1 }).world;
    const h = simulateHistory(w, 1);
    expect(h.cityFoundings.length, "the chronicle founded nothing").toBeGreaterThan(3);
    for (const c of w.cities) {
      const f = cityFacts(w, c, generateCityLayout(cityContext(c), 1), "en", KM_PER_UNIT, h.cityFoundings);
      const rec = h.cityFoundings.find((x) => x.cityId === c.id);
      expect(f.founded).toBe(rec ? rec.year : null);
      if (c.isCapital) expect(f.founded, "a capital is not founded by the chronicle").toBeNull();
    }
  });
});
