import type { Rng } from "../rng";
import { pick } from "../rng";
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

const MID_TYPES: WardType[] = ["market", "merchant", "patriciate", "craftsmen"];
const OUTER_TYPES: WardType[] = ["slum", "gate", "military", "park"];

export function assignZones(
  rng: Rng,
  wards: WardCell[],
  center: Point,
  radius: number,
  opts: { hasCastle: boolean; coastal: boolean; castleAnchor?: Point }
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
  if (opts.hasCastle) {
    const anchor = opts.castleAnchor;
    if (anchor) {
      // keep sits on the high ground: swap the ward nearest the anchor into the castle slot
      let bi = idx, bd = Infinity;
      for (let j = idx; j < out.length; j++) {
        const d = Math.hypot(out[j].site[0] - anchor[0], out[j].site[1] - anchor[1]);
        if (d < bd) { bd = d; bi = j; }
      }
      if (bi !== idx) { const t = out[idx]; out[idx] = out[bi]; out[bi] = t; }
    }
    setType("castle");
  }

  const farthest = out[out.length - 1];
  if (opts.coastal) farthest.type = "harbor";

  for (; idx < out.length; idx++) {
    const w = out[idx];
    if (w === farthest && opts.coastal) continue;
    if (w.inner) w.type = pick(rng, MID_TYPES);
    else if (w.dist > radius * 0.85) w.type = rng() < 0.5 ? "suburb" : "field";
    else w.type = pick(rng, OUTER_TYPES);
  }
  return out;
}
