import { describe, it, expect } from "vitest";
import { selectArchetype } from "./archetypes";
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
});
