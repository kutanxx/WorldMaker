import { describe, it, expect } from "vitest";
import { featureLabel } from "./featureLabel";
import { generateWorld } from "./world";
import { DEFAULT_PARAMS } from "../types/world";
import { ALPINE } from "./biome";
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
