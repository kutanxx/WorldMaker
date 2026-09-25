import { describe, it, expect } from "vitest";
import { cityFacts, POPULATION_BANDS } from "./cityFacts";
import { generateWorld } from "../engine/world";
import { simulateHistory } from "../engine/history";
import { generateCityLayout, cityContext } from "../engine/city";
import { DEFAULT_PARAMS } from "../types/world";
import { KM_PER_UNIT } from "./scaleBar";
import type { GovernmentForm } from "../engine/government";

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
    for (let i = 0; i < world.cities.length; i++) {
      const f = facts(i);
      expect(f.neighbours.length, `city ${i} points nowhere`).toBeGreaterThan(0);
      for (let k = 1; k < f.neighbours.length; k++) expect(f.neighbours[k].km).toBeGreaterThanOrEqual(f.neighbours[k - 1].km);
      for (const n of f.neighbours) {
        expect(n.id).not.toBe(world.cities[i].id);
        expect(world.cities.some((c) => c.id === n.id && c.name === n.name)).toBe(true);
        expect(n.km).toBeGreaterThan(0);
      }
    }
  });
});

// "Nearby" was the three nearest towns as the crow flies. Over twelve worlds 12 towns listed one
// across the sea (835 km of it, from one island), and on 102 of 336 plates a gate was named for a
// town the row left out — "Gate to Kaag", and no Kaag nearby. It lists the towns the roads lead to
// now, the gates' own, nearest by road first and in km along the road, the way the Gough map wrote
// a distance on each of its roads.
describe("the towns next door are the towns the roads lead to", () => {
  const worlds = [1, 11].map((seed) => generateWorld({ ...DEFAULT_PARAMS, seed }).world);
  const factsOf = (w: (typeof worlds)[number], i: number) =>
    cityFacts(w, w.cities[i], generateCityLayout(cityContext(w.cities[i]), w.params.seed), "en", KM_PER_UNIT);

  it("lists exactly the towns a town's roads lead to, in km along each road", () => {
    let towns = 0;
    for (const w of worlds) for (const c of w.cities) {
      if (!c.roads?.length) continue;
      towns++;
      const f = factsOf(w, c.id);
      expect(new Set(f.neighbours.map((n) => n.id)), `seed ${w.params.seed}: town ${c.id}`).toEqual(new Set(c.roads.map((r) => r.to)));
      for (const n of f.neighbours) {
        const road = w.roads.find((r) => (r.a === c.id && r.b === n.id) || (r.b === c.id && r.a === n.id))!;
        expect(n.km, `seed ${w.params.seed}: ${c.id} -> ${n.id}`).toBe(Math.round(road.length * KM_PER_UNIT));
      }
    }
    expect(towns).toBeGreaterThan(50);
  });

  it("never points across the water to a town no road reaches", () => {
    for (const w of worlds) for (const c of w.cities) {
      if (!c.roads?.length) continue;
      for (const n of factsOf(w, c.id).neighbours) {
        expect(c.roads.some((r) => r.to === n.id), `seed ${w.params.seed}: ${c.id} points at ${n.id}`).toBe(true);
      }
    }
  });

  // An island town of its own has no road at all; it still points at the three nearest, as the crow
  // flies, rather than at nothing.
  it("keeps the three nearest as the crow flies for a town no road leaves", () => {
    const w = worlds[1];
    const lone = w.cities.filter((c) => !c.roads?.length);
    expect(lone.length).toBeGreaterThan(0);
    for (const c of lone) {
      const f = factsOf(w, c.id);
      const nearest = w.cities.filter((o) => o.id !== c.id)
        .sort((a, b) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y)).slice(0, 3);
      expect(f.neighbours.map((n) => n.id)).toEqual(nearest.map((o) => o.id));
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

// The plate said "Realm — Melaelae" for a town whose realm fell in 460, because the fact came from
// `world.polityOf`: the ownership of year zero. The world map beside it moves through five
// centuries; this did not. And unlike the map, a city plate carries no scrubber, so naming the
// realm is not enough — the year has to travel with it or the answer is undated again.
// The plate's realm line reads a label ("Realm — 케우스두 왕국"), and the seam it goes through
// (`polityLabeller`) is the same one the map, its legend and the city list use — but this call site,
// the `forms` parameter itself, was covered only by a manual browser pass, on a seed whose scrubbed
// year happened to have no free-standing republic to look at. Constructing the three forms directly
// (rather than hunting a seed/year that naturally has all three alive at once) is deliberate: the
// point is that `cityFacts` actually consults whatever `forms` it is given, not that some seed does.
describe("the realm line carries its form of government", () => {
  const world = generateWorld({ ...DEFAULT_PARAMS, seed: 1 }).world;
  const city = world.cities[0];
  const layout = generateCityLayout(cityContext(city), 1);
  const owner = world.polityOf[city.cell];

  it("labels the realm 왕국/자유도시/제국 by the form given — the same word for the same form every time", () => {
    const cases: [GovernmentForm, RegExp][] = [
      [{ form: "kingdom", since: null }, /왕국$/],
      [{ form: "republic", since: null }, /자유도시$/],
      [{ form: "empire", since: 100 }, /제국$/],
    ];
    for (const [form, suffix] of cases) {
      const forms = new Map<number, GovernmentForm>([[owner, form]]);
      const f = cityFacts(world, city, layout, "ko", KM_PER_UNIT, [], undefined, forms);
      expect(f.realm, form.form).toMatch(suffix);
    }
  });

  it("falls back to plain transliteration when no forms map is given, same as before this parameter existed", () => {
    const f = cityFacts(world, city, layout, "ko", KM_PER_UNIT);
    expect(f.realm).not.toMatch(/(왕국|자유도시|제국)$/);
  });
});

// I1: `cityFacts` feeds the plate's own name and its neighbours' names, and nothing asserted either
// one was actually transliterated — deleting `properName(` from cityFacts.ts:70 or :76 left every
// other test green while a Korean reader saw a Latin name in the facts panel beside a Hangul plate.
describe("the facts panel names in the reader's language", () => {
  const world = generateWorld({ ...DEFAULT_PARAMS, seed: 1 }).world;
  const hasLatin = (s: string) => /[A-Za-z]/.test(s);

  it("keeps the plate's own name and its neighbours' names out of Latin in Korean, and in Latin in English", () => {
    const c = world.cities[0];
    const layout = generateCityLayout(cityContext(c), 1);
    for (const lang of ["en", "ko"] as const) {
      const f = cityFacts(world, c, layout, lang, KM_PER_UNIT);
      const names = [f.name, ...f.neighbours.map((n) => n.name)];
      expect(names.length).toBeGreaterThan(1);   // the own name plus at least one neighbour
      for (const name of names) {
        if (lang === "ko") expect(hasLatin(name), `"${name}" has a Latin letter on the Korean plate`).toBe(false);
        else expect(hasLatin(name), `"${name}" has no Latin letter in English`).toBe(true);
      }
    }
  });
});

describe("the realm a plate names is the realm of a stated year", () => {
  const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 2 });
  const history = simulateHistory(world, 2);
  // Chosen by the property the test is about — a town that changes hands across the five centuries
  // — and not by name. It used to name Liaeth outright, and broke the day the name generator was
  // taught to make sayable names: the town was still there, still changing hands, and the test
  // could no longer find it. A test that pins a generated string is testing the generator.
  const lastSnap = history.snapshots[history.snapshots.length - 1];
  const city = world.cities.find((c) =>
    history.snapshots[0].owner[c.cell] >= 0 && lastSnap.owner[c.cell] >= 0
    && history.snapshots[0].owner[c.cell] !== lastSnap.owner[c.cell])!;
  const layout = generateCityLayout(cityContext(city), 2);
  const at = (yearIndex: number) =>
    cityFacts(world, city, layout, "en", 3, history.cityFoundings, {
      owner: history.snapshots[yearIndex].owner,
      polities: history.polities,
      year: history.snapshots[yearIndex].year,
    });

  it("names the realm holding the town in that year, not its founding realm", () => {
    const first = at(0), last = at(history.snapshots.length - 1);
    const ownerLast = history.snapshots[history.snapshots.length - 1].owner[city.cell];
    expect(first.realm).toBe(history.polities[history.snapshots[0].owner[city.cell]].name);
    expect(last.realm).toBe(history.polities[ownerLast].name);
    expect(last.realm).not.toBe(first.realm);   // which is how the town was chosen, above
  });

  it("carries the year the answer is true of", () => {
    expect(at(history.snapshots.length - 1).year).toBe(500);
    expect(at(0).year).toBe(0);
  });
});
