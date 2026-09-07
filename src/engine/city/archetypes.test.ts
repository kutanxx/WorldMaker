import { describe, it, expect } from "vitest";
import { selectArchetype, TABLE } from "./archetypes";
import { TAIGA, TEMPERATE_FOREST, TROPICAL, DESERT, WETLAND, GRASSLAND, TUNDRA } from "../biome";

const inland = { coastal: false, elevation: 0.5, size: 4 };

describe("selectArchetype", () => {
  it("coastal wins over biome", () => {
    expect(selectArchetype({ ...inland, coastal: true, biome: DESERT }).id).toBe("coastalPort");
  });
  it("high elevation wins over biome", () => {
    expect(selectArchetype({ ...inland, elevation: 0.8, biome: WETLAND }).id).toBe("hilltopFortress");
  });
  it("maps inland biomes to biome archetypes", () => {
    expect(selectArchetype({ ...inland, biome: WETLAND }).id).toBe("marshStilt");
    expect(selectArchetype({ ...inland, biome: DESERT }).id).toBe("desertOasis");
    for (const b of [TEMPERATE_FOREST, TAIGA, TROPICAL]) {
      expect(selectArchetype({ ...inland, biome: b }).id).toBe("forestGrove");
    }
    expect(selectArchetype({ ...inland, biome: GRASSLAND }).id).toBe("plainsMarket");
    expect(selectArchetype({ ...inland, biome: TUNDRA }).id).toBe("plainsMarket");
  });
  it("gives the new archetypes their signature traits", () => {
    const forest = selectArchetype({ ...inland, biome: TEMPERATE_FOREST });
    expect(forest.wallMaterial).toBe("timber");
    expect(forest.vegetation).toBe("trees");
    const marsh = selectArchetype({ ...inland, biome: WETLAND });
    expect(marsh.onStilts).toBe(true);
    const desert = selectArchetype({ ...inland, biome: DESERT });
    expect(desert.oasis).toBe(true);
    expect(desert.groundColor).toBe("#ece0c2");
  });
  it("existing archetypes keep stone defaults", () => {
    const plains = selectArchetype({ ...inland, biome: GRASSLAND });
    expect(plains.wallMaterial).toBe("stone");
    expect(plains.vegetation).toBe("none");
    expect(plains.onStilts).toBe(false);
    expect(plains.oasis).toBe(false);
  });
  it("a world river through the cell makes an inland town a river town (river shown in the drilldown)", () => {
    // The property is that the river reaches the plan, not which of the two river kinds is drawn:
    // most are bridge towns, about a third sit in a meander loop instead. Wetland keeps its marsh.
    const river = (biome: number, pick: number) => selectArchetype({ ...inland, biome, river: true, pick }).id;
    for (const biome of [GRASSLAND, TEMPERATE_FOREST, DESERT]) { // a Nile through the sands
      expect(river(biome, 0.9)).toBe("bridgeTown");
      expect(river(biome, 0.1)).toBe("meanderDefense");
    }
    expect(river(WETLAND, 0.1)).toBe("marshStilt");
    expect(river(WETLAND, 0.9)).toBe("marshStilt");
    // coast + elevation still win over the river branch
    expect(selectArchetype({ ...inland, coastal: true, biome: GRASSLAND, river: true }).id).toBe("coastalPort");
    expect(selectArchetype({ ...inland, elevation: 0.9, biome: GRASSLAND, river: true }).id).toBe("hilltopFortress");
    // both river kinds carry water; only which kind differs
    expect(selectArchetype({ ...inland, biome: GRASSLAND, river: true, pick: 0.9 }).water).toBe("river");
    expect(selectArchetype({ ...inland, biome: GRASSLAND, river: true, pick: 0.1 }).water).toBe("meander");
  });
  it("spreads the high ground across all of its kinds of town, by `pick`", () => {
    const mtn = { ...inland, elevation: 0.9, biome: GRASSLAND };
    const got = new Set<string>();
    for (let pick = 0; pick < 1; pick += 0.02) got.add(selectArchetype({ ...mtn, pick }).id);
    expect(got).toEqual(new Set(["hilltopFortress", "hillside", "spur", "valleyPass"]));
    // pick omitted -> the first variant (backward compatible)
    expect(selectArchetype(mtn).id).toBe("hilltopFortress");
  });

  // The gate stood at 0.70 and the highest town in 840 measured 0.741, so mountain towns arrived
  // 0.2 times per world of 28 -- the whole mountain-city feature reached under 1% of towns and most
  // worlds had none at all. At 0.60 it is ~1.8 per world: a reader meets one, and it is still rare.
  // 0.60 also stays clear of the world map's own alpine line (mountainLevel 0.55), so a foothill
  // town is not drawn as a mountain one.
  it("gives the high ground its own kinds of town, at a height towns actually reach", () => {
    expect(selectArchetype({ ...inland, elevation: 0.60, biome: GRASSLAND, pick: 0 }).id).toBe("hilltopFortress");
    expect(selectArchetype({ ...inland, elevation: 0.59, biome: GRASSLAND, pick: 0 }).id).toBe("plainsMarket");
  });
});

// A census of 840 town plans turned up two archetypes that had never been drawn. They did not turn
// out to be the same problem. meanderDefense was a finished kind of town with no road leading to it
// -- organic streets inside a riverbank wall, wrapped by a meander -- and now has one. ridgeLinear
// was a DUPLICATE: identical to valleyPass in street field, wall shape and water, differing only in
// a parchment tint, so routing it would have added a second name for one plan rather than a kind of
// town. It was deleted instead. This guards the table against acquiring another of either.
describe("the archetype table has no unreachable entries", () => {
  it("can produce every kind of town it defines", () => {
    const seen = new Set<string>();
    for (const coastal of [true, false]) {
      for (const elevation of [0.35, 0.5, 0.65, 0.9]) {
        for (const river of [true, false]) {
          for (const biome of [GRASSLAND, DESERT, WETLAND, TAIGA, TEMPERATE_FOREST, TROPICAL, TUNDRA]) {
            for (let pick = 0; pick < 1; pick += 0.05) {
              seen.add(selectArchetype({ coastal, elevation, size: 3, biome, river, pick }).id);
            }
          }
        }
      }
    }
    expect([...Object.keys(TABLE)].filter((id) => !seen.has(id))).toEqual([]);
  });
});
