import type { Rng } from "../rng";
import { pick } from "../rng";

export type ArchetypeId =
  | "coastalPort" | "bridgeTown" | "hilltopFortress"
  | "meanderDefense" | "plainsMarket" | "ridgeLinear";
export type StreetField = "radial" | "grid" | "linear" | "organic";
export type WaterKind = "sea" | "river" | "lake" | "meander" | "none";
export type WallShape = "hull" | "rect" | "contour" | "riverbank";

export interface Archetype {
  id: ArchetypeId;
  streetField: StreetField;
  wallShape: WallShape;
  water: WaterKind;
}

const TABLE: Record<ArchetypeId, Archetype> = {
  coastalPort: { id: "coastalPort", streetField: "organic", wallShape: "hull", water: "sea" },
  bridgeTown: { id: "bridgeTown", streetField: "linear", wallShape: "riverbank", water: "river" },
  hilltopFortress: { id: "hilltopFortress", streetField: "radial", wallShape: "contour", water: "none" },
  meanderDefense: { id: "meanderDefense", streetField: "organic", wallShape: "riverbank", water: "meander" },
  plainsMarket: { id: "plainsMarket", streetField: "grid", wallShape: "rect", water: "lake" },
  ridgeLinear: { id: "ridgeLinear", streetField: "linear", wallShape: "rect", water: "none" },
};

const INLAND: ArchetypeId[] = ["bridgeTown", "meanderDefense", "plainsMarket", "ridgeLinear"];

export function selectArchetype(
  opts: { coastal: boolean; elevation: number; size: number },
  rng: Rng
): Archetype {
  if (opts.coastal) return TABLE.coastalPort;
  if (opts.elevation >= 0.7) return TABLE.hilltopFortress;
  return TABLE[pick(rng, INLAND)];
}
