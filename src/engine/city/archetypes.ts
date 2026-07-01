import { TAIGA, TEMPERATE_FOREST, TROPICAL, DESERT, WETLAND } from "../biome";

export type ArchetypeId =
  | "coastalPort" | "bridgeTown" | "hilltopFortress"
  | "meanderDefense" | "plainsMarket" | "ridgeLinear"
  | "forestGrove" | "marshStilt" | "desertOasis";
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
};

export function selectArchetype(
  opts: { coastal: boolean; elevation: number; size: number; biome: number }
): Archetype {
  if (opts.coastal) return TABLE.coastalPort;
  if (opts.elevation >= 0.7) return TABLE.hilltopFortress;
  switch (opts.biome) {
    case WETLAND: return TABLE.marshStilt;
    case DESERT: return TABLE.desertOasis;
    case TEMPERATE_FOREST:
    case TAIGA:
    case TROPICAL: return TABLE.forestGrove;
    default: return TABLE.plainsMarket;
  }
}
