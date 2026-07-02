import type { Rng } from "./rng";
import { randInt } from "./rng";
import { makeNameGen } from "./names";
import type { Phonetics } from "./names";
import { OCEAN } from "./terrain";

export interface Culture { name: string; color: string; phon: Phonetics }

// phonetic profiles spanning harsh↔soft (research: guttural=harsh, bilabial/liquid=soft)
export const CULTURE_PROFILES: { color: string; phon: Phonetics }[] = [
  { color: "#9a5a3a", phon: { // guttural — mountain / barbarian
    onset: ["kr", "gr", "dr", "k", "g", "kh", "thr", "gg", "vr", "gru"],
    vowel: ["a", "o", "u", "au", "aa"], coda: ["k", "rk", "gg", "th", "gr", "r", "kh"] } },
  { color: "#4a7a8a", phon: { // liquid — melodic / southern
    onset: ["l", "m", "n", "el", "li", "va", "sy", "ae", "ly", "mel"],
    vowel: ["ae", "ia", "io", "ei", "e", "a", "ea"], coda: ["l", "n", "r", "th", "el", "", "an"] } },
  { color: "#b89a4a", phon: { // sibilant — desert / silk-road
    onset: ["s", "sh", "z", "kh", "dh", "sa", "za", "si", "sha"],
    vowel: ["a", "i", "aa", "ai", "ia"], coda: ["s", "r", "n", "h", "", "sh", "z"] } },
  { color: "#6a5a8a", phon: { // sonorous — classical / imperial
    onset: ["t", "d", "v", "m", "r", "c", "tr", "l", "cor", "val"],
    vowel: ["a", "e", "o", "u", "i"], coda: ["us", "um", "an", "or", "is", "", "ar"] } },
  { color: "#5a7a5a", phon: { // nordic — coastal / rugged
    onset: ["f", "v", "sk", "th", "h", "br", "sv", "fj", "hr"],
    vowel: ["o", "a", "y", "ei", "au"], coda: ["nd", "rn", "k", "r", "", "vik", "fr"] } },
];

type GridLike = { count: number; points: number[] };

export function assignCultures(
  rng: Rng, grid: GridLike, terrain: number[], count: number,
): { cultureOf: Int32Array; cultures: Culture[] } {
  const land: number[] = [];
  for (let i = 0; i < grid.count; i++) if (terrain[i] !== OCEAN) land.push(i);
  const k = Math.max(1, Math.min(CULTURE_PROFILES.length, count, land.length));
  const px = (i: number) => grid.points[i * 2];
  const py = (i: number) => grid.points[i * 2 + 1];
  const d2 = (a: number, b: number) => (px(a) - px(b)) ** 2 + (py(a) - py(b)) ** 2;

  // seed min-separated culture centres on land
  const centers: number[] = [];
  const minSep2 = 250 * 250;
  for (let attempt = 0; centers.length < k && attempt < k * 80; attempt++) {
    const c = land[randInt(rng, 0, land.length - 1)];
    if (centers.every((cc) => d2(c, cc) > minSep2)) centers.push(c);
  }
  for (let li = 0; centers.length < k && li < land.length; li++) { // fallback: relax separation
    if (!centers.includes(land[li])) centers.push(land[li]);
  }

  const cultures: Culture[] = centers.map((_, i) => {
    const prof = CULTURE_PROFILES[i % CULTURE_PROFILES.length];
    return { name: makeNameGen(rng, prof.phon).nation(), color: prof.color, phon: prof.phon };
  });

  const cultureOf = new Int32Array(grid.count).fill(-1);
  for (const c of land) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < centers.length; i++) { const d = d2(c, centers[i]); if (d < bd) { bd = d; best = i; } }
    cultureOf[c] = best;
  }
  return { cultureOf, cultures };
}
