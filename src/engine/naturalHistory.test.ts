import { describe, it, expect } from "vitest";
import { generateWorld } from "./world";
import { DEFAULT_PARAMS } from "../types/world";
import { simulateHistory } from "./history";
import { naturalHistory } from "./naturalHistory";
import { TUNDRA, TAIGA, ALPINE, TEMPERATE_FOREST, TROPICAL } from "./biome";

const build = (seed: number) => {
  const { world } = generateWorld({ ...DEFAULT_PARAMS, seed });
  return { world, history: simulateHistory(world, seed) };
};

// Everything the chronicle recorded was politics: realms founding, conquering, splitting and
// falling. Nothing ever happened TO a place — no plague, no fire, no flood, no hungry winter —
// which is why five centuries of it read as a campaign log.
//
// The simulation models none of these, so unlike the mined chronicle they are invented, and the
// rule that governs invention here was paid for once already: a chronicle that founds towns the
// atlas never drew is telling the reader about somewhere they cannot go. So every one of these
// lands ON A CITY THAT IS ON THE MAP, at a year after that city was founded, in the realm that
// actually held it then — and only where the place makes it possible. A town does not flood
// without a river.
describe("naturalHistory", () => {
  it("is the same natural history every time the world is read", () => {
    const { world, history } = build(1);
    expect(naturalHistory(world, history, "en")).toEqual(naturalHistory(world, history, "en"));
  });

  it("gives different worlds different luck", () => {
    const one = build(1), two = build(2);
    const a = naturalHistory(one.world, one.history, "en").map((l) => l.text);
    const b = naturalHistory(two.world, two.history, "en").map((l) => l.text);
    expect(a).not.toEqual(b);
  });

  it("keeps to a handful a world, so the chronicle is not swamped by disasters", () => {
    for (const seed of [1, 2, 3]) {
      const { world, history } = build(seed);
      const n = naturalHistory(world, history, "en").length;
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(10);
    }
  });

  it("only ever names a town that is on the map", () => {
    let checked = 0;
    for (const seed of [1, 2, 3]) {
      const { world, history } = build(seed);
      const names = new Set(world.cities.map((c) => c.name));
      const realms = new Set(history.polities.map((p) => p.name));
      for (const e of naturalHistory(world, history, "en")) {
        if (e.cityId !== undefined) { expect(names.has(world.cities[e.cityId].name)).toBe(true); checked++; }
        expect(realms.has(history.polities[e.polityId!]?.name ?? "")).toBe(true);
      }
    }
    expect(checked).toBeGreaterThan(5);
  });

  // The lesson the chronicle's own newCity events had to learn: a town that the history has not
  // founded yet is not somewhere a fire can burn.
  it("never burns, floods or starves a town before the chronicle has founded it", () => {
    let checked = 0;
    for (const seed of [1, 2, 3, 4]) {
      const { world, history } = build(seed);
      const foundedAt = new Map(history.cityFoundings.map((f) => [f.cityId, f.year]));
      for (const e of naturalHistory(world, history, "en")) {
        if (e.cityId === undefined) continue;
        expect(e.year).toBeGreaterThanOrEqual(foundedAt.get(e.cityId) ?? 0);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(5);
  });

  it("only drowns a town a river runs through, and only burns a timber one", () => {
    let floods = 0, fires = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const { world, history } = build(seed);
      for (const e of naturalHistory(world, history, "en")) {
        if (e.cityId === undefined) continue;
        const c = world.cities[e.cityId];
        if (e.kind === "flood") { expect(c.river).toBe(true); floods++; }
        if (e.kind === "fire") {
          expect([TAIGA, TEMPERATE_FOREST, TROPICAL]).toContain(c.biome);
          fires++;
        }
        if (e.kind === "winter") expect([TUNDRA, TAIGA, ALPINE]).toContain(c.biome);
        if (e.kind === "plague") expect(c.coastal || c.size >= 4).toBe(true);
      }
    }
    expect(floods + fires).toBeGreaterThan(0);   // the branches ran; not vacuously green
  });

  it("names the realm that actually held the town that year", () => {
    let checked = 0;
    for (const seed of [1, 2, 3]) {
      const { world, history } = build(seed);
      for (const e of naturalHistory(world, history, "en")) {
        if (e.cityId === undefined) continue;
        let snap = history.snapshots[0];
        for (const s of history.snapshots) if (s.year <= e.year) snap = s;
        expect(snap.owner[world.cities[e.cityId].cell]).toBe(e.polityId);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(5);
  });

  it("tells it in the reader's language and in no other", () => {
    const { world, history } = build(1);
    const en = naturalHistory(world, history, "en");
    const ko = naturalHistory(world, history, "ko");
    expect(ko.length).toBe(en.length);
    expect(ko.map((l) => l.kind)).toEqual(en.map((l) => l.kind));
    expect(en.every((l) => !/[가-힣]/.test(l.text))).toBe(true);
    expect(ko.some((l) => /[가-힣]/.test(l.text))).toBe(true);
  });
});

// What the finished lines looked like on seed 2 the first time they were read on the site:
//   plague comes ashore at Fjor ... (year 220)
//   plague comes ashore at Fjor ... (year 380)
//   a winter without end at Zaiashair; Zaiashair counts what it lost
// Five of the eight were plague, one town was struck twice in the same words, and a town that
// shares its realm's name said that name twice in one sentence. All three are failures of the
// TELLING rather than of the grounding, and none of them shows up in a count.
describe("the misfortunes read like a record and not like a list", () => {
  it("never strikes the same town twice in one world", () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const { world, history } = build(seed);
      const towns = naturalHistory(world, history, "en")
        .filter((e) => e.cityId !== undefined).map((e) => e.cityId);
      expect(towns.length).toBe(new Set(towns).size);
    }
  });

  it("spreads across the kinds a world can actually have, rather than repeating the commonest", () => {
    let seedsChecked = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const { world, history } = build(seed);
      const events = naturalHistory(world, history, "en");
      const kinds = new Set(events.map((e) => e.kind));
      expect(kinds.size).toBeGreaterThanOrEqual(3);
      // and no single kind may account for more than half of them
      for (const k of kinds) {
        expect(events.filter((e) => e.kind === k).length).toBeLessThanOrEqual(Math.ceil(events.length / 2));
      }
      seedsChecked++;
    }
    expect(seedsChecked).toBe(6);
  });

  it("does not say a name twice when a town and its realm share one", () => {
    let checked = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const { world, history } = build(seed);
      for (const e of naturalHistory(world, history, "en")) {
        if (e.cityId === undefined) continue;
        const town = world.cities[e.cityId].name;
        const realm = history.polities[e.polityId!].name;
        if (town !== realm) continue;
        expect(e.text.split(town).length - 1).toBe(1);   // the name appears once, not twice
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);   // some world does name a town after its realm
  });
});
