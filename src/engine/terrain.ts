import type { Grid } from "./grid";

export const OCEAN = 0;
export const LAND = 1;
export const MOUNTAIN = 2;

export function classifyTerrain(
  heights: Float32Array,
  seaLevel: number,
  mountainLevel: number
): Uint8Array {
  const t = new Uint8Array(heights.length);
  for (let i = 0; i < heights.length; i++) {
    t[i] = heights[i] < seaLevel ? OCEAN : heights[i] > mountainLevel ? MOUNTAIN : LAND;
  }
  return t;
}

export function landmasses(grid: Grid, terrain: Uint8Array): Int32Array {
  const comp = new Int32Array(terrain.length).fill(-1);
  let id = 0;
  for (let i = 0; i < terrain.length; i++) {
    if (terrain[i] === OCEAN || comp[i] !== -1) continue;
    comp[i] = id;
    const stack = [i];
    while (stack.length) {
      const c = stack.pop()!;
      for (const n of grid.neighbors[c]) {
        if (terrain[n] !== OCEAN && comp[n] === -1) {
          comp[n] = id;
          stack.push(n);
        }
      }
    }
    id++;
  }
  return comp;
}
