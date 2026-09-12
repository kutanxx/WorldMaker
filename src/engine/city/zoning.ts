import type { Rng } from "../rng";
import type { Point, Polygon } from "../geometry";
import { area } from "../geometry";
import type { WardCell } from "./wards";

export type WardType =
  | "plaza" | "castle" | "cathedral" | "guildhall"
  | "market" | "merchant" | "patriciate" | "craftsmen"
  | "gate" | "slum" | "harbor" | "military" | "park";

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
  opts: { hasCastle: boolean; coastal: boolean; castleAnchor?: Point; seaAnchor?: Point;
    // true if a ward polygon stands in open water. The castle used to be sited by proximity alone,
    // and proximity knows nothing about a river: the enceinte, its towers and in five towns of 333
    // the castle GATE came out over the water. A lord builds on ground he can defend, so the seat
    // takes the nearest DRY ward, and only falls back to the nearest of any when the town has no
    // dry ward at all (a marsh town on stilts).
    wet?: (poly: Polygon) => boolean;
    // true if the ward is mostly UNDER the water rather than merely touching it. A landmark put
    // there is a name floating on open water: an outside review found a town whose lake had
    // swallowed the Guildhall ward while the label stayed, so the map read as a lake called
    // Guildhall. Such a ward still exists — the mesh has no holes — it is simply not somewhere the
    // town would put its cathedral.
    drowned?: (poly: Polygon) => boolean;
    // how far the ward's own EDGE stands from the water. `wet` — does the polygon overlap a water
    // body — was the zoning's only water sense, and an all-or-nothing predicate cannot rank a
    // shore: over 12 seeds, 59 of 139 harbour towns had no ward overlapping the water at all, and
    // on those the pick fell back to bearing alone, which cannot tell a quayside from a ward three
    // streets inland.
    waterDist?: (poly: Polygon) => number;
    // the area inside the wall, which is what a reader sees. Wards run past the wall (the mesh is
    // laid to the town's reach and the plate clips it), so their own total is the wrong yardstick
    // for "how much of this town is parkland".
    walledArea?: number }
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
  // ★ The docks have the first claim on the waterfront — ahead of the plaza, the cathedral and the
  // guildhall. A port town grew around its harbour: the waterfront IS its economic centre and the
  // civic landmarks arranged themselves around it. Taking the landmarks first and the harbour from
  // what was left put the docks inland whenever the ward that met the water happened to be central
  // — Aerael (seed 2) had its guildhall on the shore and its harbour 102 units back, on a 460-unit
  // plate.
  // Measured over 12 seeds / 139 harbour towns, ward-edge to water: median 4.5 → 2.0 units, worst
  // 102 → 41, and the ward chosen is the nearest the town has to the water in every one of them.
  // A threshold ("pre-empt only a ward that actually touches the water") was measured too and earns
  // no constant: by 40 units it never fires, because a ward standing that far back from the water
  // is the nearest one the town has.
  let harborWard: ZonedWard | null = null;
  if (opts.coastal && opts.waterDist) {
    let bi = -1, bd = Infinity;
    for (let j = 0; j < out.length; j++) {
      if (opts.drowned?.(out[j].polygon)) continue;     // a ward the water swallowed has no quayside
      const d = opts.waterDist(out[j].polygon);
      if (d < bd) { bd = d; bi = j; }
    }
    if (bi >= 0) harborWard = out[bi];
  }

  // the civic landmarks take the innermost wards, but skip any the water has taken (and any the
  // docks already hold): swap the next dry one up into place rather than founding a cathedral in
  // a lake
  const setType = (t: WardType) => {
    let j = idx;
    for (; j < out.length; j++) {
      if (out[j] === harborWard) continue;
      if (opts.drowned?.(out[j].polygon)) continue;
      break;
    }
    if (j >= out.length) {                              // nothing dry left: take a drowned ward...
      for (j = idx; j < out.length && out[j] === harborWard; j++);
      if (j >= out.length) return;                      // ...but never the docks; the landmark waits
    }
    if (j !== idx) { const tmp = out[idx]; out[idx] = out[j]; out[j] = tmp; }
    out[idx++].type = t;
  };
  setType("plaza");
  setType("cathedral");
  setType("guildhall");
  // The town gave no water sense at all (no `waterDist`), or the water had swallowed every ward:
  // the harbour takes the best of what the landmarks left, by the seaward bearing, and with neither
  // it takes the outermost ward — the old rule, kept because it is the only one those callers have.
  if (opts.coastal && !harborWard) {
    let bi = -1, bd = Infinity;
    for (let j = idx; j < out.length; j++) {
      const d = opts.waterDist ? opts.waterDist(out[j].polygon)
        : opts.seaAnchor ? Math.hypot(out[j].site[0] - opts.seaAnchor[0], out[j].site[1] - opts.seaAnchor[1])
        : Infinity;
      if (d < bd) { bd = d; bi = j; }
    }
    harborWard = bi >= 0 ? out[bi] : out[out.length - 1];
  }
  if (opts.hasCastle) {
    const anchor = opts.castleAnchor;
    if (anchor) {
      // keep sits on the high ground: swap the ward nearest the anchor into the castle slot
      let bi = idx, bd = Infinity;        // nearest of any ward
      let dry = -1, dryD = Infinity;      // nearest ward standing clear of the water
      for (let j = idx; j < out.length; j++) {
        if (out[j] === harborWard) continue; // don't consume the harbor ward
        const d = Math.hypot(out[j].site[0] - anchor[0], out[j].site[1] - anchor[1]);
        if (d < bd) { bd = d; bi = j; }
        if (opts.wet && !opts.wet(out[j].polygon) && d < dryD) { dryD = d; dry = j; }
      }
      if (dry >= 0) bi = dry;
      if (bi !== idx) { const t = out[idx]; out[idx] = out[bi]; out[bi] = t; }
    }
    setType("castle");
  }

  if (harborWard) harborWard.type = "harbor";

  // tiny cities can run out of wards before the castle slot — the lord's seat still claims one
  // (every walled town has its castle): repurpose the outermost non-harbor ward.
  if (opts.hasCastle && !out.some((w) => w.type === "castle")) {
    let last = -1;
    for (let j = out.length - 1; j >= 0; j--) {
      if (out[j] === harborWard) continue;
      if (last < 0) last = j;
      if (!opts.wet || !opts.wet(out[j].polygon)) { last = j; break; }
    }
    if (last >= 0) out[last].type = "castle";
  }

  // medieval social zonation by distance from the civic core: market at the heart (beside the
  // plaza), the wealthy (merchant/patriciate) in the inner ring, artisans (craftsmen) in the
  // middle, the poor + garrison (slum/military/park) at the rim, urban all the way to the wall
  // (farming lives outside the walls, in the extramural suburbs).
  let placedMarket = false;
  for (; idx < out.length; idx++) {
    const w = out[idx];
    if (w === harborWard) continue;
    const f = w.dist / radius;
    if (f > 0.85) { const r = rng(); w.type = r < 0.5 ? "slum" : r < 0.8 ? "craftsmen" : "park"; continue; } // urban to the wall
    if (!placedMarket && f < 0.5) { w.type = "market"; placedMarket = true; continue; } // the market square
    if (f < 0.45) w.type = rng() < 0.5 ? "merchant" : "patriciate";        // wealthy inner ring
    else if (f < 0.72) w.type = rng() < 0.08 ? "market" : "craftsmen";      // artisan middle ring (rare 2nd market)
    else w.type = rng() < 0.55 ? "slum" : rng() < 0.5 ? "military" : "park"; // poor/garrison rim
  }

  // ...and then the parkland is capped. A rim ward is a park about one time in five, which reads
  // right on average — a measured median of 7.8% of the walled area — but a big rim ward drawing
  // the short straw twice gave towns that were half green: p90 26%, worst 50.5%. A walled town
  // spares ground for a common and a churchyard, not for a country park. The largest parks give way
  // first, to the tenement rows the rim would otherwise have been. No rng: size order decides.
  const PARK_CAP = 0.16;
  const total = opts.walledArea ?? out.reduce((t, w) => t + Math.abs(area(w.polygon)), 0);
  if (total > 0) {
    const parks = out.filter((w) => w.type === "park").sort((a, b) => Math.abs(area(b.polygon)) - Math.abs(area(a.polygon)));
    let green = parks.reduce((t, w) => t + Math.abs(area(w.polygon)), 0);
    for (const w of parks) {
      if (green / total <= PARK_CAP) break;
      green -= Math.abs(area(w.polygon));
      w.type = "slum";
    }
  }
  return out;
}
