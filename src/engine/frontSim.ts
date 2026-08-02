import type { World } from "../types/world";
import { OCEAN } from "./terrain";
import { BIOME_DEF } from "./armySim";

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

export const ATTACK_SPEED = 0.05;
export const FORCE_MIN = 0.2;
export const FORCE_MAX = 3;
export const COST_ATK = 1.0;
export const COST_DEF = 0.6;

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

// Rough ground costs more to take. Deliberately the same weighting the army game uses rather than a
// second table that could drift away from it.
export function terrainDef(s: FrontState, cell: number): number {
  return BIOME_DEF[s.world.biome[cell]] ?? 1;
}

// The target's cells that touch the attacker. Its LENGTH is the border, and the border is what sets
// how fast a front moves — a realm with a long frontier is taken quickly and a compact one is not.
// Ascending cell order so every consumer sees the same sequence.
export function borderCells(s: FrontState, attacker: number, target: number): number[] {
  const out: number[] = [];
  for (let c = 0; c < s.n; c++) {
    if (s.owner[c] !== target) continue;
    for (const q of s.world.grid.neighbors[c]) {
      if (s.owner[q] === attacker) { out.push(c); break; }
    }
  }
  return out;
}

// Committing is instant and visible: the troops leave the pool now, not when they arrive. Returns
// false — and costs nothing — when there is nothing to attack across.
export function startAttack(s: FrontState, attacker: number, target: number, fraction: number): boolean {
  // SEA is not a nation and holds no troops: reaching it here would let advanceAttacks treat ocean
  // cells as unowned land (its only check is `target >= 0`) and permanently annex them as territory.
  if (attacker === target || target === SEA || s.troops[attacker] === undefined) return false;
  // A non-finite fraction survives Math.min/Math.max unclamped (NaN <= 0 is false), which would push
  // a front with pool = NaN that can never advance and never runs out — an attack that lives forever.
  if (!Number.isFinite(fraction)) return false;
  if (borderCells(s, attacker, target).length === 0) return false;
  const pool = s.troops[attacker] * Math.min(1, Math.max(0, fraction));
  if (pool <= 0) return false;
  cancelAttack(s, attacker, target);                 // one front per pair; re-committing replaces it
  s.troops[attacker] -= pool;
  s.attacks.push({ attacker, target, pool, progress: 0 });
  return true;
}

// The one rule for troops coming back into a reserve, however they get there: a nation can never hold
// more than its own cap. Without this, cancelling a front after the reserve has regenerated back up
// is free money — repeat it and the pool grows without bound, defeating the whole point of the cap.
function refundToPool(s: FrontState, nation: number, amount: number): void {
  s.troops[nation] = Math.min(maxTroops(s, nation), s.troops[nation] + amount);
}

// Calling off a front hands its survivors back rather than deleting them, so probing an enemy is not
// punished by the accounting.
export function cancelAttack(s: FrontState, attacker: number, target: number): void {
  const i = s.attacks.findIndex((a) => a.attacker === attacker && a.target === target);
  if (i < 0) return;
  refundToPool(s, attacker, s.attacks[i].pool);
  s.attacks.splice(i, 1);
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

// One step of every front. Deterministic throughout: fronts run in array order, and within a front
// the border is walked in ascending cell id, so the same state always yields the same captures.
function advanceAttacks(s: FrontState): void {
  for (const atk of [...s.attacks]) {
    const border = borderCells(s, atk.attacker, atk.target);
    if (border.length === 0) {
      // The target is gone (fully conquered) or the attacker's own border cells were lost elsewhere —
      // either way there is nothing left to fight. That is not the same as the pool running out in
      // combat: refund the survivors, or finishing a conquest would annihilate the army that did it
      // and cancelling one cell early would always beat seeing the attack through.
      refundToPool(s, atk.attacker, atk.pool);
      s.attacks = s.attacks.filter((x) => x !== atk);
      continue;
    }
    if (atk.pool <= 0) { s.attacks = s.attacks.filter((x) => x !== atk); continue; }
    const defence = atk.target >= 0 ? Math.max(1, s.troops[atk.target]) : 0;
    // Unowned land has nobody to hold it, so a front there always runs at full speed.
    const force = defence === 0
      ? FORCE_MAX
      : Math.min(FORCE_MAX, Math.max(FORCE_MIN, atk.pool / defence));
    // Accumulate rather than round down: a front whose budget is a fraction of a cell per tick has
    // to creep, not stall. Dropping the remainder would freeze every slow push permanently.
    atk.progress += force * border.length * ATTACK_SPEED;
    for (const cell of border) {
      if (atk.progress < 1 || atk.pool <= 0) break;
      const def = terrainDef(s, cell);
      atk.pool -= COST_ATK * def;
      if (atk.target >= 0) s.troops[atk.target] = Math.max(0, s.troops[atk.target] - COST_DEF * def);
      setOwner(s, cell, atk.attacker);
      atk.progress -= 1;
    }
    if (atk.pool <= 0) s.attacks = s.attacks.filter((x) => x !== atk);
  }
}

export function tick(s: FrontState): void {
  for (let p = 0; p < s.troops.length; p++) {
    s.troops[p] = Math.min(maxTroops(s, p), s.troops[p] + regenPerTick(s, p));
  }
  advanceAttacks(s);
  s.tick++;
}
