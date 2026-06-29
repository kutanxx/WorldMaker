import type { Rng } from "./rng";
import { randInt } from "./rng";
import type { Grid } from "./grid";
import { OCEAN } from "./terrain";

export interface PolitySeed {
  id: number;
  capital: number;
  color: string;
}

export interface PolityMap {
  polityOf: Int32Array;
  seeds: PolitySeed[];
}

const PALETTE = [
  "#cabfe6", "#bfe0d4", "#f0d9a8", "#e6b8c2", "#b8cce6",
  "#d4e6b8", "#e6d0b8", "#c2b8e6", "#b8e6dd", "#e6c2b8",
];

/**
 * Seed up to `count` polities on random land cells, then multi-source BFS so
 * each connected land cell is claimed by exactly one polity.
 * Contract: `polityOf[i]` is -1 for ocean or unclaimed cells. On sparse maps
 * with little land, fewer than `count` polities may be seeded (best-effort);
 * callers must treat `seeds.length` as authoritative, not `count`.
 */
export function assignPolities(
  rng: Rng,
  grid: Grid,
  terrain: Uint8Array,
  count: number
): PolityMap {
  const land: number[] = [];
  for (let i = 0; i < terrain.length; i++) if (terrain[i] !== OCEAN) land.push(i);

  const polityOf = new Int32Array(terrain.length).fill(-1);
  const seeds: PolitySeed[] = [];
  let attempts = 0;
  while (seeds.length < count && land.length > 0 && attempts < count * 50) {
    attempts++;
    const cell = land[randInt(rng, 0, land.length - 1)];
    if (polityOf[cell] !== -1) continue;
    const id = seeds.length;
    polityOf[cell] = id;
    seeds.push({ id, capital: cell, color: PALETTE[id % PALETTE.length] });
  }

  let frontier = seeds.map((s) => s.capital);
  while (frontier.length) {
    const next: number[] = [];
    for (const c of frontier) {
      for (const n of grid.neighbors[c]) {
        if (terrain[n] !== OCEAN && polityOf[n] === -1) {
          polityOf[n] = polityOf[c];
          next.push(n);
        }
      }
    }
    frontier = next;
  }
  return { polityOf, seeds };
}
