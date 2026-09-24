import type { Grid } from "./grid";
import { MOUNTAIN, OCEAN } from "./terrain";

export type ReliefKind = "summit" | "valley" | "spur" | "slope";
export interface Relief { relief: ReliefKind; bearing: number }

// Ground this much higher or lower than the town rises or falls; less is level.
const LEVEL = 0.015;
// A valley's two walls stand at least this far apart round the compass — or the ground rises in this
// many eighths of it round a hollow.
const WALLS_APART = (2 * Math.PI) / 3, BASIN = 6;
// A spur's high ground fills no more than this many eighths of the compass, and the ground falls away
// in at least this many: a plane tilted one way rises in three.
const SPUR_ARC = 2, SPUR_FALLS = 4;

/**
 * The lie of the land at a town in the mountains, read off the heights round it: the highest ground
 * in each eighth of the compass within two cells, against the town's own. A cell's own neighbours
 * alone are too few to tell a spur from a slope — over twelve worlds a ridge crest read as a spur and
 * two towns sitting in hollows as slopes.
 *
 * - SUMMIT: nothing round it rises. Its bearing is where the ground stays highest — the ridge running on.
 * - VALLEY: higher ground on two sides — between two walls, on a pass between two heights, or in a
 *   hollow. Its bearing is the line its walls stand on (either way along it).
 * - SPUR: the high ground behind it is narrow and the ground falls away round the rest.
 * - SLOPE: the ground rises across a broad front.
 * A spur's or a slope's bearing is uphill. The sea is not ground: it neither rises nor walls a valley.
 * Undefined for a town not in the mountains.
 */
export function reliefAt(
  grid: Pick<Grid, "points" | "neighbors">, heights: ArrayLike<number>, terrain: ArrayLike<number>, cell: number,
): Relief | undefined {
  if (terrain[cell] !== MOUNTAIN) return undefined;
  const x = grid.points[cell * 2], y = grid.points[cell * 2 + 1], h = heights[cell];
  const near = new Set<number>(grid.neighbors[cell]);
  for (const n of grid.neighbors[cell]) for (const m of grid.neighbors[n]) near.add(m);
  near.delete(cell);
  const top = new Array<number>(8).fill(-Infinity);   // the highest ground in each eighth, over the town's
  for (const n of near) {
    if (terrain[n] === OCEAN) continue;
    const a = Math.atan2(grid.points[n * 2 + 1] - y, grid.points[n * 2] - x);
    const k = (Math.round((a / (2 * Math.PI)) * 8) + 8) % 8;
    top[k] = Math.max(top[k], heights[n] - h);
  }
  const dirOf = (k: number) => (k * Math.PI) / 4;
  const rises = top.map((d) => d >= LEVEL);
  const risen = rises.filter(Boolean).length;
  if (!risen) {
    const highest = Math.max(...top);
    return { relief: "summit", bearing: highest === -Infinity ? 0 : dirOf(top.indexOf(highest)) };
  }
  // the heading of some rising eighths, each weighted by how far it rises
  const toward = (ks: number[]) => {
    let sx = 0, sy = 0;
    for (const k of ks) { sx += Math.cos(dirOf(k)) * top[k]; sy += Math.sin(dirOf(k)) * top[k]; }
    return Math.atan2(sy, sx);
  };
  // the runs of rising eighths round the compass, largest first
  const runs: number[][] = [];
  const start = rises.findIndex((r, k) => r && !rises[(k + 7) % 8]);
  if (start < 0) runs.push([0, 1, 2, 3, 4, 5, 6, 7]);
  else for (let i = 0; i < 8; i++) {
    const k = (start + i) % 8;
    if (!rises[k]) continue;
    if (i > 0 && rises[(k + 7) % 8]) runs[runs.length - 1].push(k); else runs.push([k]);
  }
  runs.sort((p, q) => q.length - p.length);
  const apart = runs.length >= 2 ? Math.abs(Math.atan2(Math.sin(toward(runs[0]) - toward(runs[1])), Math.cos(toward(runs[0]) - toward(runs[1])))) : 0;
  if (risen >= BASIN || apart >= WALLS_APART) {
    // doubled angles, so two walls opposite each other add up instead of cancelling
    let cx = 0, cy = 0;
    for (let k = 0; k < 8; k++) if (rises[k]) { cx += Math.cos(2 * dirOf(k)) * top[k]; cy += Math.sin(2 * dirOf(k)) * top[k]; }
    return { relief: "valley", bearing: Math.atan2(cy, cx) / 2 };
  }
  const uphill = toward(rises.flatMap((r, k) => (r ? [k] : [])));
  const falls = top.filter((d) => d <= -LEVEL).length;
  return { relief: risen <= SPUR_ARC && falls >= SPUR_FALLS ? "spur" : "slope", bearing: uphill };
}
