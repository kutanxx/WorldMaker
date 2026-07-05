import { TAIGA, TEMPERATE_FOREST, TROPICAL, DESERT, WETLAND } from "../biome";

export type ArchetypeId =
  | "coastalPort" | "bridgeTown" | "hilltopFortress"
  | "meanderDefense" | "plainsMarket" | "ridgeLinear"
  | "forestGrove" | "marshStilt" | "desertOasis"
  | "hillside" | "spur" | "valleyPass";
export type StreetField = "radial" | "grid" | "linear" | "organic";
export type WaterKind = "sea" | "river" | "lake" | "meander" | "none";
export type WallShape = "hull" | "rect" | "contour" | "riverbank";

export interface Archetype {
  id: ArchetypeId;
  streetField: StreetField;
  wallShape: WallShape;
  water: WaterKind;
  wallMaterial: "stone" | "timber";
  vegetation: "trees" | "none";
  onStilts: boolean;
  oasis: boolean;
  groundColor: string;
}

type Traits = Pick<Archetype, "wallMaterial" | "vegetation" | "onStilts" | "oasis" | "groundColor">;
const BASE: Traits = { wallMaterial: "stone", vegetation: "none", onStilts: false, oasis: false, groundColor: "#efe7d2" };

const TABLE: Record<ArchetypeId, Archetype> = {
  coastalPort: { id: "coastalPort", streetField: "organic", wallShape: "hull", water: "sea", ...BASE },
  bridgeTown: { id: "bridgeTown", streetField: "linear", wallShape: "riverbank", water: "river", ...BASE },
  hilltopFortress: { id: "hilltopFortress", streetField: "radial", wallShape: "contour", water: "none", ...BASE },
  meanderDefense: { id: "meanderDefense", streetField: "organic", wallShape: "riverbank", water: "meander", ...BASE },
  plainsMarket: { id: "plainsMarket", streetField: "grid", wallShape: "rect", water: "lake", ...BASE },
  ridgeLinear: { id: "ridgeLinear", streetField: "linear", wallShape: "rect", water: "none", ...BASE },
  forestGrove: { id: "forestGrove", streetField: "organic", wallShape: "hull", water: "none", ...BASE, wallMaterial: "timber", vegetation: "trees", groundColor: "#e3e7d0" },
  marshStilt: { id: "marshStilt", streetField: "organic", wallShape: "riverbank", water: "meander", ...BASE, wallMaterial: "timber", onStilts: true, groundColor: "#dfe4dc" },
  desertOasis: { id: "desertOasis", streetField: "organic", wallShape: "hull", water: "none", ...BASE, oasis: true, groundColor: "#ece0c2" },
  hillside: { id: "hillside", streetField: "organic", wallShape: "hull", water: "none", ...BASE, groundColor: "#e8e2d6" },
  spur: { id: "spur", streetField: "radial", wallShape: "hull", water: "none", ...BASE, groundColor: "#e8e2d6" },
  valleyPass: { id: "valleyPass", streetField: "linear", wallShape: "rect", water: "none", ...BASE, groundColor: "#e8e2d6" },
};

const MOUNTAIN_VARIANTS: ArchetypeId[] = ["hilltopFortress", "hillside", "spur", "valleyPass"];

export function selectArchetype(
  opts: { coastal: boolean; elevation: number; size: number; biome: number; pick?: number; river?: boolean }
): Archetype {
  if (opts.coastal) return TABLE.coastalPort;
  if (opts.elevation >= 0.7) {
    const i = Math.min(MOUNTAIN_VARIANTS.length - 1, Math.floor((opts.pick ?? 0) * MOUNTAIN_VARIANTS.length));
    return TABLE[MOUNTAIN_VARIANTS[i]];
  }
  // a world river runs through this cell → the drilldown must show it (world<->city coupling).
  // Wetlands keep their marsh meander; every other inland biome becomes a bridge town on the river.
  if (opts.river) return opts.biome === WETLAND ? TABLE.marshStilt : TABLE.bridgeTown;
  switch (opts.biome) {
    case WETLAND: return TABLE.marshStilt;
    case DESERT: return TABLE.desertOasis;
    case TEMPERATE_FOREST:
    case TAIGA:
    case TROPICAL: return TABLE.forestGrove;
    default: return TABLE.plainsMarket;
  }
}
