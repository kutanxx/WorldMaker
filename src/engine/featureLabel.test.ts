import { describe, it, expect } from "vitest";
import { featureLabel } from "./featureLabel";
import { generateWorld } from "./world";
import { DEFAULT_PARAMS } from "../types/world";
import { ALPINE } from "./biome";

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
});
