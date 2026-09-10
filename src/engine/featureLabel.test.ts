import { describe, it, expect } from "vitest";
import { featureLabel, ADJ_KO, NOUN_KO, WORLD_NOUN_KO } from "./featureLabel";
import { generateWorld } from "./world";
import { DEFAULT_PARAMS } from "../types/world";
import { ALPINE, OCEAN } from "./biome";
import { NOUNS, ADJ, WORLD_NOUN } from "./geography";
import { RIVER_NOUNS } from "./rivers";

describe("featureLabel", () => {
  it("renders the three patterns in English exactly as the generator wrote them", () => {
    expect(featureLabel({ pattern: "adj", kind: ALPINE, adj: "Iron", noun: "Spires" }, "en"))
      .toBe("the Iron Spires");
    expect(featureLabel({ pattern: "of", kind: ALPINE, noun: "Barrens", proper: "Dimbrerk" }, "en"))
      .toBe("Barrens of Dimbrerk");
    expect(featureLabel({ pattern: "attributive", kind: ALPINE, noun: "Wilds", proper: "Trianork" }, "en"))
      .toBe("Trianork Wilds");
    expect(featureLabel({ pattern: "attributive", kind: -1, noun: "", proper: "Sodend" }, "en")).toBe("Sodend");
  });

  // THE test of this task. The structure is not a second opinion about the name, it IS the name:
  // if this passes on every seed, no English string on the map or in the gazetteer can move.
  it("reproduces every generated English name, byte for byte, across twenty seeds", () => {
    let checked = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const { world } = generateWorld({ ...DEFAULT_PARAMS, seed });
      for (const r of world.regions) {
        expect(featureLabel(r.label, "en"), `seed ${seed} region`).toBe(r.name);
        checked++;
      }
      for (const r of world.rivers) {
        expect(featureLabel(r.label, "en"), `seed ${seed} river`).toBe(r.name);
        checked++;
      }
      expect(featureLabel(world.nameLabel, "en"), `seed ${seed} world`).toBe(world.name);
      checked++;
    }
    expect(checked).toBeGreaterThan(300);
  });

  // The Korean noun lookup (task 3) will do NOUN_KO[label.noun] — so `label.noun` must ALWAYS be a
  // word out of a source table, never an invented one, or the lookup renders "undefined" onto the
  // map. This is the invariant the river branch broke: it swapped `noun`/`proper` so `noun` held an
  // invented word for roughly a third of rivers. Walking generated labels (not the source tables
  // themselves) is what catches it — a table-only test can't see how the fields were populated.
  it("keeps label.noun a table word and label.adj an ADJ entry, across twenty seeds", () => {
    const validNouns = new Set<string>([...Object.values(NOUNS).flat(), ...RIVER_NOUNS, ...WORLD_NOUN, ""]);
    const validAdj = new Set(ADJ);
    let checked = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const { world } = generateWorld({ ...DEFAULT_PARAMS, seed });
      const labels = [...world.regions.map((r) => r.label), ...world.rivers.map((r) => r.label), world.nameLabel];
      for (const label of labels) {
        expect(validNouns.has(label.noun), `seed ${seed} noun "${label.noun}" (pattern ${label.pattern})`).toBe(true);
        if (label.adj !== undefined) {
          expect(validAdj.has(label.adj), `seed ${seed} adj "${label.adj}"`).toBe(true);
        }
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(300);
  });
});

describe("featureLabel in Korean", () => {
  it("puts the noun last, and the proper name in front of its 의", () => {
    expect(featureLabel({ pattern: "adj", kind: ALPINE, adj: "Iron", noun: "Spires" }, "ko"))
      .toBe("무쇠 첨봉");
    expect(featureLabel({ pattern: "of", kind: ALPINE, noun: "Barrens", proper: "Dimbrerk" }, "ko"))
      .toBe("딤브레르크의 황무지");
    expect(featureLabel({ pattern: "attributive", kind: ALPINE, noun: "Wilds", proper: "Trianork" }, "ko"))
      .toBe("트리아노르크 야생지");
  });

  // The fourth pattern. English puts a river's noun FIRST ("River Gruathgra"); Korean has no such
  // word order — the noun goes last either way — so nounFirst and attributive render identically,
  // and this is the test that says so.
  it("renders nounFirst exactly like attributive, because Korean has only the one order", () => {
    expect(featureLabel({ pattern: "nounFirst", kind: -1, noun: "River", proper: "Gruathgra" }, "ko"))
      .toBe("그루아스그라 강");
    expect(featureLabel({ pattern: "attributive", kind: -1, noun: "River", proper: "Gruathgra" }, "ko"))
      .toBe("그루아스그라 강");
    expect(featureLabel({ pattern: "nounFirst", kind: -1, noun: "River", proper: "Gruathgra" }, "en"))
      .toBe("River Gruathgra");
  });

  // worldName's bare branch carries noun "" — the world is just "Sodend", and a trailing space
  // would open a gap in the map's title cartouche.
  it("writes the bare world name alone, with nothing after it", () => {
    expect(featureLabel({ pattern: "attributive", kind: -1, noun: "", proper: "Sodend" }, "ko")).toBe("소덴드");
  });

  // `kind === -1` is NOT the world's alone: riverName builds `{pattern:"adj", kind:-1}` with a
  // RIVER noun, so the world table can only be reached through a word that is IN it. The two
  // tables collide on exactly one word, and this is it.
  it("keeps a world's Expanse and an ocean's Expanse different words", () => {
    expect(featureLabel({ pattern: "adj", kind: -1, adj: "Endless", noun: "Expanse" }, "ko"))
      .toBe(`${ADJ_KO["Endless"]} ${WORLD_NOUN_KO["Expanse"]}`);
    expect(featureLabel({ pattern: "adj", kind: OCEAN, adj: "Endless", noun: "Expanse" }, "ko"))
      .toBe(`${ADJ_KO["Endless"]} ${NOUN_KO["Expanse"]}`);
    expect(WORLD_NOUN_KO["Expanse"]).not.toBe(NOUN_KO["Expanse"]);
    // ...and a river drawn with the adjective pattern still reads as a river.
    expect(featureLabel({ pattern: "adj", kind: -1, adj: "Endless", noun: "Race" }, "ko"))
      .toBe(`${ADJ_KO["Endless"]} ${NOUN_KO["Race"]}`);
  });

  it("has a Korean word for every English one the generator can pick", () => {
    // 20 adjectives + 37 region nouns + 7 river nouns + 5 world nouns. A missing entry has to be a
    // failing test, not an English word surfacing on a Korean map.
    for (const a of ADJ) expect(ADJ_KO[a], `no Korean for adjective ${a}`).toBeTruthy();
    for (const list of Object.values(NOUNS)) for (const n of list) expect(NOUN_KO[n], `no Korean for noun ${n}`).toBeTruthy();
    for (const n of RIVER_NOUNS) expect(NOUN_KO[n], `no Korean for river noun ${n}`).toBeTruthy();
    for (const n of WORLD_NOUN) expect(WORLD_NOUN_KO[n], `no Korean for world noun ${n}`).toBeTruthy();
  });

  it("gives each English word its own Korean word", () => {
    // A sibling task exists to stop one map calling three places the same thing; a translation
    // table that collapses Moor and Barrens onto 황무지 would undo it in the other language. The
    // adjectives carry the same burden — nearly half the names on a map are "the <adj> <noun>".
    const all = Object.values(NOUN_KO);
    expect(new Set(all).size, `${all.length - new Set(all).size} Korean nouns are shared`).toBe(all.length);
    const adjs = Object.values(ADJ_KO);
    expect(new Set(adjs).size, `${adjs.length - new Set(adjs).size} Korean adjectives are shared`).toBe(adjs.length);
  });

  // The map is the point of the whole feature: not one Latin letter may reach a Korean reader.
  it("leaves no Latin in any generated name, across twenty seeds", () => {
    let checked = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const { world } = generateWorld({ ...DEFAULT_PARAMS, seed });
      const labels = [...world.regions.map((r) => r.label), ...world.rivers.map((r) => r.label),
                      ...world.provinces.map((p) => p.label), world.nameLabel];
      for (const label of labels) {
        const ko = featureLabel(label, "ko");
        expect(ko, `seed ${seed} ${label.pattern} "${featureLabel(label, "en")}"`).not.toMatch(/[A-Za-z]/);
        expect(ko.trim(), `seed ${seed} "${ko}" has an edge space`).toBe(ko);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(2000);    // ~100 provinces a seed
  });

  it("still reproduces the English string it always did", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 3 });
    for (const r of world.regions) expect(featureLabel(r.label, "en")).toBe(r.name);
    // A province name has structure too, or the province view is the one map left in English.
    for (const p of world.provinces) expect(featureLabel(p.label, "en")).toBe(p.name);
  });
});
