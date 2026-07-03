import type { Rng } from "../rng";
import type { Point, Polygon } from "../geometry";
import type { WardCell } from "./wards";

export type WardType =
  | "plaza" | "castle" | "cathedral" | "guildhall"
  | "market" | "merchant" | "patriciate" | "craftsmen"
  | "gate" | "slum" | "harbor" | "military" | "park"
  | "suburb" | "field";

export interface ZonedWard {
  polygon: Polygon;
  site: Point;
  type: WardType;
  inner: boolean;
  dist: number;
}

export function assignZones(
  rng: Rng,
  wards: WardCell[],
  center: Point,
  radius: number,
  opts: { hasCastle: boolean; coastal: boolean; castleAnchor?: Point; seaAnchor?: Point }
): ZonedWard[] {
  if (wards.length === 0) return [];
  const ranked = wards
    .map((w) => ({ w, dist: Math.hypot(w.site[0] - center[0], w.site[1] - center[1]) }))
    .sort((a, b) => a.dist - b.dist);

  const innerCut = radius * 0.6;
  const out: ZonedWard[] = ranked.map(({ w, dist }) => ({
    polygon: w.polygon,
    site: w.site,
    dist,
    inner: dist <= innerCut,
    type: "craftsmen" as WardType,
  }));

  let idx = 0;
  const setType = (t: WardType) => {
    if (idx < out.length) out[idx++].type = t;
  };
  setType("plaza");
  setType("cathedral");
  setType("guildhall");
  // harbor ward: the district nearest the SEA (a coastal city knows the water side via
  // seaAnchor). Falls back to the farthest-from-centre ward if no sea anchor is supplied.
  // Captured BEFORE any castle-anchor swap so the swap can't steal it.
  let harborWard: ZonedWard | null = null;
  if (opts.coastal) {
    if (opts.seaAnchor) {
      let bi = -1, bd = Infinity;
      for (let j = idx; j < out.length; j++) {
        const d = Math.hypot(out[j].site[0] - opts.seaAnchor[0], out[j].site[1] - opts.seaAnchor[1]);
        if (d < bd) { bd = d; bi = j; }
      }
      harborWard = bi >= 0 ? out[bi] : out[out.length - 1];
    } else {
      harborWard = out[out.length - 1];
    }
  }
  if (opts.hasCastle) {
    const anchor = opts.castleAnchor;
    if (anchor) {
      // keep sits on the high ground: swap the ward nearest the anchor into the castle slot
      let bi = idx, bd = Infinity;
      for (let j = idx; j < out.length; j++) {
        if (out[j] === harborWard) continue; // don't consume the harbor ward
        const d = Math.hypot(out[j].site[0] - anchor[0], out[j].site[1] - anchor[1]);
        if (d < bd) { bd = d; bi = j; }
      }
      if (bi !== idx) { const t = out[idx]; out[idx] = out[bi]; out[bi] = t; }
    }
    setType("castle");
  }

  if (harborWard) harborWard.type = "harbor";

  // medieval social zonation by distance from the civic core: market at the heart (beside the
  // plaza), the wealthy (merchant/patriciate) in the inner ring, artisans (craftsmen) in the
  // middle, the poor + garrison (slum/military/park) at the rim, fields/faubourgs at the edge.
  let placedMarket = false;
  for (; idx < out.length; idx++) {
    const w = out[idx];
    if (w === harborWard) continue;
    const f = w.dist / radius;
    if (f > 0.85) { w.type = rng() < 0.5 ? "suburb" : "field"; continue; } // fields/faubourgs
    if (!placedMarket && f < 0.5) { w.type = "market"; placedMarket = true; continue; } // the market square
    if (f < 0.45) w.type = rng() < 0.5 ? "merchant" : "patriciate";        // wealthy inner ring
    else if (f < 0.72) w.type = rng() < 0.08 ? "market" : "craftsmen";      // artisan middle ring (rare 2nd market)
    else w.type = rng() < 0.55 ? "slum" : rng() < 0.5 ? "military" : "park"; // poor/garrison rim
  }
  return out;
}
