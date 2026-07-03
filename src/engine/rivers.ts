import type { River, RiverSegment } from "../types/world";
import type { Rng } from "./rng";
import { pick } from "./rng";
import { makeNameGen, type Phonetics } from "./names";
import { ADJ } from "./geography";
import { OCEAN } from "./terrain";
import {
  TUNDRA, TAIGA, TEMPERATE_FOREST, GRASSLAND, DESERT, TROPICAL, WETLAND, ALPINE,
} from "./biome";

export interface RawRiver { mouthCell: number; path: [number, number][]; flux: number }
export interface RiverNetwork { segments: RiverSegment[]; trunks: RawRiver[] }

type GridLike = { count: number; neighbors: number[][]; points: number[] };

const EPS = 1e-5;
// Tuned across seeds 1–20: DRAW_FRAC 0.04 flooded the map (river cells ~21% of land, up to
// 39%); 0.10 gives a legible dendritic net (~7% median, ≤14% on the wettest seed, still ≥4%
// on the driest). MAX_NAMED 5 (was 7) trims label clutter — NAME_FRAC keeps it adaptive so
// river-poor worlds still name fewer.
const DRAW_FRAC = 0.1;
const NAME_FRAC = 0.25;
const MAX_NAMED = 5;

// rainfall by biome — wetter biomes and snowmelt uplands feed bigger rivers
const RAIN: Record<number, number> = {
  [DESERT]: 0.3, [TUNDRA]: 0.5, [GRASSLAND]: 0.7, [TAIGA]: 1.0,
  [TEMPERATE_FOREST]: 1.0, [ALPINE]: 1.2, [WETLAND]: 1.4, [TROPICAL]: 1.6,
};

export function traceRivers(
  grid: GridLike, heights: ArrayLike<number>, terrain: ArrayLike<number>, biome: ArrayLike<number>,
): RiverNetwork {
  const n = grid.count;
  const filled = new Float64Array(n);
  const receiver = new Int32Array(n).fill(-1);
  const processed = new Uint8Array(n);
  const popOrder: number[] = [];

  // binary min-heap of cell indices keyed by (filled, index) — the index tie-break makes
  // pop order deterministic regardless of heap internals
  const heap: number[] = [];
  const less = (a: number, b: number) =>
    filled[a] < filled[b] || (filled[a] === filled[b] && a < b);
  const swap = (i: number, j: number) => { const t = heap[i]; heap[i] = heap[j]; heap[j] = t; };
  const push = (c: number) => {
    heap.push(c);
    let i = heap.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (less(heap[i], heap[p])) { swap(i, p); i = p; } else break; }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = 2 * i + 2; let s = i;
        if (l < heap.length && less(heap[l], heap[s])) s = l;
        if (r < heap.length && less(heap[r], heap[s])) s = r;
        if (s === i) break; swap(i, s); i = s;
      }
    }
    return top;
  };

  // Priority-Flood + ε: seed with ocean cells, expand to lowest unprocessed neighbour
  for (let c = 0; c < n; c++) {
    if (terrain[c] === OCEAN) { filled[c] = heights[c]; processed[c] = 1; push(c); }
  }
  while (heap.length) {
    const c = pop();
    popOrder.push(c);
    for (const nb of grid.neighbors[c]) {
      if (processed[nb]) continue;
      filled[nb] = Math.max(heights[nb], filled[c] + EPS);
      receiver[nb] = c;
      processed[nb] = 1;
      push(nb);
    }
  }

  // flux accumulation: reverse pop order = filled-height descending = reverse-topological
  const flux = new Float64Array(n);
  for (let c = 0; c < n; c++) if (terrain[c] !== OCEAN) flux[c] = RAIN[biome[c]] ?? 1.0;
  for (let k = popOrder.length - 1; k >= 0; k--) {
    const c = popOrder[k];
    if (terrain[c] === OCEAN) continue;
    const r = receiver[c];
    if (r >= 0) flux[r] += flux[c];
  }

  // adaptive threshold from the largest mouth flux
  let maxMouthFlux = 0;
  for (let c = 0; c < n; c++) {
    if (terrain[c] !== OCEAN && receiver[c] >= 0 && terrain[receiver[c]] === OCEAN) {
      if (flux[c] > maxMouthFlux) maxMouthFlux = flux[c];
    }
  }
  if (maxMouthFlux <= 0) return { segments: [], trunks: [] };
  const drawThreshold = DRAW_FRAC * maxMouthFlux;

  const px = (c: number) => grid.points[c * 2];
  const py = (c: number) => grid.points[c * 2 + 1];

  // network segments (includes the mouth hop into the ocean cell, so rivers reach the sea)
  const segments: RiverSegment[] = [];
  const children: number[][] = Array.from({ length: n }, () => []);
  for (let c = 0; c < n; c++) {
    if (terrain[c] === OCEAN || receiver[c] < 0 || flux[c] < drawThreshold) continue;
    const r = receiver[c];
    segments.push({ x1: px(c), y1: py(c), x2: px(r), y2: py(r), f: flux[c] });
    children[r].push(c); // upstream river cell feeding r
  }

  // named trunks: mouths above the "major" bar, most flux first (index tie-break)
  const mouths: number[] = [];
  for (let c = 0; c < n; c++) {
    if (terrain[c] !== OCEAN && receiver[c] >= 0 && terrain[receiver[c]] === OCEAN && flux[c] >= drawThreshold) {
      mouths.push(c);
    }
  }
  mouths.sort((a, b) => flux[b] - flux[a] || a - b);
  const named = mouths.filter((m) => flux[m] >= NAME_FRAC * maxMouthFlux).slice(0, MAX_NAMED);

  const trunks: RawRiver[] = named.map((m) => {
    const path: [number, number][] = [[px(m), py(m)]];
    let cur = m;
    for (;;) {
      const kids = children[cur];
      if (!kids.length) break;
      let best = kids[0];
      for (const k of kids) if (flux[k] > flux[best] || (flux[k] === flux[best] && k < best)) best = k;
      path.push([px(best), py(best)]);
      cur = best;
    }
    return { mouthCell: m, path, flux: flux[m] };
  });

  return { segments, trunks };
}

const RIVER_NOUNS = ["River", "Water", "Run", "Fork", "Flow", "Race", "Rill"];

function riverName(rng: Rng, phon: Phonetics): string {
  const noun = pick(rng, RIVER_NOUNS);
  const ng = makeNameGen(rng, phon);
  const r = rng();
  if (r < 0.45) return `the ${pick(rng, ADJ)} ${noun}`;
  if (r < 0.75) return `${ng.place()} ${noun}`;
  return `${noun} ${ng.place()}`;
}

export function nameRivers(
  rng: Rng, trunks: RawRiver[], phonAt: (cell: number) => Phonetics,
): River[] {
  return trunks.map((t) => ({
    name: riverName(rng, phonAt(t.mouthCell)),
    path: t.path,
    flux: t.flux,
    mouth: t.path[0],
  }));
}
