import type { World } from "../types/world";
import { OCEAN } from "./terrain";

// One troop pool per nation and no army units at all: a nation's whole military is a single number,
// and attacking is committing part of it to a front rather than moving something across the map.
export const TICK_HZ = 10;          // simulation steps per second; only the UI knows about seconds
export const TROOP_EXP = 0.6;
export const TROOP_BASE = 200;      // floor, so a one-cell nation is not starved out instantly
export const TROOP_SCALE = 60;
export const REGEN_BASE = 1;
export const REGEN_K = 0.25;
// Growth scales with the pool you already have, but sublinearly, so a large realm does not simply
// refill proportionally faster than a small one. Taken from the reference game unchanged.
export const REGEN_EXP = 0.73;

export const UNOWNED = -1;
export const SEA = -2;

// `progress` carries the fraction of a cell left over from the previous tick. Without it a front
// whose per-tick budget is below one cell would never move at all — and at these constants most
// fronts start there, so a slow push has to accumulate rather than round to nothing.
export interface Attack { attacker: number; target: number; pool: number; progress: number }

export interface FrontState {
  world: World;
  n: number;              // cell count
  owner: Int32Array;      // cell -> nation, UNOWNED, or SEA
  tiles: Int32Array;      // nation -> cells held; maintained incrementally, never recounted per tick
  troops: Float64Array;   // nation -> troop pool
  attacks: Attack[];
  tick: number;
}

export function initFrontSim(world: World): FrontState {
  const n = world.grid.count;
  const owner = new Int32Array(n);
  const tiles = new Int32Array(world.polities.length);
  for (let c = 0; c < n; c++) {
    if (world.terrain[c] === OCEAN) { owner[c] = SEA; continue; }
    const p = world.polityOf[c];
    owner[c] = p >= 0 && p < tiles.length ? p : UNOWNED;
    if (owner[c] >= 0) tiles[owner[c]]++;
  }
  const troops = new Float64Array(tiles.length).fill(TROOP_BASE / 2);
  return { world, n, owner, tiles, troops, attacks: [], tick: 0 };
}

// The only way ownership changes. Going through one door is what keeps `tiles` from drifting out of
// step with `owner` — and `tiles` exists because maxTroops is read for every nation every tick, and
// recounting 4,000 cells that often is waste we would feel at 10 ticks a second.
export function setOwner(s: FrontState, cell: number, nation: number): void {
  const prev = s.owner[cell];
  if (prev === nation) return;
  if (prev >= 0) s.tiles[prev]--;
  s.owner[cell] = nation;
  if (nation >= 0) s.tiles[nation]++;
}

// Sublinear in territory: ten times the land is about 2.9x the ceiling. Conquest yields land faster
// than it yields power, which is the damper this genre runs on. It slows the runaway; it does not
// stop it, and the spec is explicit that this game does not claim to.
export function maxTroops(s: FrontState, nation: number): number {
  return TROOP_BASE + TROOP_SCALE * Math.pow(s.tiles[nation] ?? 0, TROOP_EXP);
}

// Growth dies as the pool fills, so sitting at the cap throws away most of your income. This is the
// pressure that makes a player spend troops instead of hoarding them — the single thing that was
// most obviously missing from the turn-based game this replaces.
export function regenPerTick(s: FrontState, nation: number): number {
  const max = maxTroops(s, nation);
  const t = s.troops[nation];
  if (t >= max) return 0;
  return (REGEN_BASE + Math.pow(t, REGEN_EXP) * REGEN_K) * (1 - t / max);
}

export function tick(s: FrontState): void {
  for (let p = 0; p < s.troops.length; p++) {
    s.troops[p] = Math.min(maxTroops(s, p), s.troops[p] + regenPerTick(s, p));
  }
  s.tick++;
}
