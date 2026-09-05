import { OCEAN } from "../engine/terrain";

/** The part of a Grid this needs, kept structural so a test can hand it a hand-built one. */
export interface NeighborGrid { count: number; neighbors: number[][] }

// Half the biome patches on a generated world are one or two cells across. Measured over seeds 1, 7,
// 42 and 834932: 44-47% of land patches are that small, and together they hold 4.4-5.9% of the land,
// against biggest patches of 100-357 cells. On the map they are specks — a dark-green dot inside a
// plain, one marsh cell in a desert — and they read as scatter rather than as terrain, for almost no
// information.
//
// The renderer already makes this judgement elsewhere: it skips the mountain glyph on an alpine cell
// with no alpine neighbour, "only draw where mountains cluster into a range". The fill went on
// calling that cell a mountain anyway. This applies the same judgement to colour.
//
// ⚠ FOR DRAWING ONLY. It never touches `world.biome`, because city placement, population and the
// history simulation are all built on that array and moving it would move the golden anchors. That
// is also why this lives in ui/ and not engine/ — nothing that generates a world should reach for it.
export function displayBiomes(
  grid: NeighborGrid, biome: ArrayLike<number>, minPatch = 2,
): Int32Array {
  let cur = Int32Array.from(biome as ArrayLike<number>);
  // One pass is not enough. Reading every tally from the same snapshot keeps the result independent
  // of cell order, but it also means two adjacent specks decide separately, and a speck that lands
  // on a biome its new neighbours do not share is a fresh speck. So repeat until nothing moves —
  // patches only ever grow, so this settles quickly (two passes on the seeds measured); the bound is
  // there so a pathological world cannot spin.
  for (let pass = 0; pass < 8; pass++) {
    const next = Int32Array.from(cur);
    const seen = new Uint8Array(grid.count);
    let moved = 0;
    for (let c = 0; c < grid.count; c++) {
      if (seen[c] || cur[c] === OCEAN) continue;
      const bm = cur[c];
      const patch = [c];
      seen[c] = 1;
      for (let i = 0; i < patch.length; i++) {
        for (const nb of grid.neighbors[patch[i]]) {
          if (!seen[nb] && cur[nb] === bm) { seen[nb] = 1; patch.push(nb); }
        }
      }
      if (patch.length > minPatch) continue;
      // Whichever land biome most of its neighbours are, read from this pass's snapshot so cell
      // order cannot change the answer. Ties fall to the lower biome id, so the same world always
      // draws the same way.
      const tally = new Map<number, number>();
      for (const p of patch) {
        for (const nb of grid.neighbors[p]) {
          const nbm = cur[nb];
          if (nbm === OCEAN || nbm === bm) continue;
          tally.set(nbm, (tally.get(nbm) ?? 0) + 1);
        }
      }
      let best = -1, bestN = 0;
      for (const [id, n] of [...tally].sort((a, b) => a[0] - b[0])) if (n > bestN) { bestN = n; best = id; }
      // A speck with nothing but sea around it is a real island, not noise — leave it alone.
      if (best >= 0) for (const p of patch) { next[p] = best; moved++; }
    }
    cur = next;
    if (!moved) break;
  }
  return cur;
}
