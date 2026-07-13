// Reign legacy — the per-seed dynasty annals (Dwarf Fortress "the world persists" + the
// morgue-file lesson: a run record should read like a story). A fixed 7-field schema recorded
// only when a reign ENDS — deliberately NOT save/load, so there is no SimState migration tax.
import type { DilemmaOutcome } from "../engine/dilemma";
import { ASCENSION_CAP } from "../engine/historySim";

export const LEGACY_CAP = 20; // rows kept per seed (the reign counter keeps counting past it)
export const LEGACY_SHOW = 5; // rows the picker panel shows

export type LegacyKind = "conquest" | "prosperity" | "endurance" | "defeat";
export type EpitaphCode =
  | "epiFallen" | "epiUnified" | "epiSlewHegemon" | "epiSurvivedShadow"
  | "epiProphecy" | "epiGoldenAge" | "epiEndured";

export interface LegacyEntry {
  v: 1;
  n: number;                    // 제N대 — 1-based reign counter per seed
  nation: string;
  kind: LegacyKind;
  cause: string;                // conqueror name when kind === "defeat"
  year: number;
  peakCells: number;
  citiesFounded: number;
  asc?: number;                 // ascension level the run was played at (absent for A0 / legacy rows)
  epitaph: { code: EpitaphCode; data: Record<string, string | number> };
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;
const key = (seed: number) => `wm:legacy:${seed}`;
function defaultStorage(): StorageLike | null {
  try { return typeof localStorage !== "undefined" ? localStorage : null; } catch { return null; }
}

// reads never throw: corrupt JSON / missing storage / wrong shape all yield []
export function loadLegacy(seed: number, storage: StorageLike | null = defaultStorage()): LegacyEntry[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(key(seed));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((e) => e && e.v === 1 && typeof e.n === "number" && typeof e.nation === "string");
  } catch { return []; }
}

export function recordReign(seed: number, entry: Omit<LegacyEntry, "v" | "n">, storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  try {
    const prev = loadLegacy(seed, storage);
    const n = (prev[0]?.n ?? 0) + 1;
    const next: LegacyEntry[] = [{ v: 1 as const, n, ...entry }, ...prev].slice(0, LEGACY_CAP);
    storage.setItem(key(seed), JSON.stringify(next));
  } catch { /* quota/privacy failures must never break the game */ }
}

export function seedBestPeak(entries: LegacyEntry[]): number {
  let best = 0;
  for (const e of entries) if (e.peakCells > best) best = e.peakCells;
  return best;
}

// the one sentence that tells the run's story — how it ended beats how it was lived
export function composeEpitaph(kind: LegacyKind, cause: string, highlights: DilemmaOutcome[]): LegacyEntry["epitaph"] {
  if (kind === "defeat") return { code: "epiFallen", data: { name: cause } };
  if (kind === "conquest") return { code: "epiUnified", data: {} };
  const slew = highlights.find((h) => h.code === "hegemonVictory");
  if (slew) return { code: "epiSlewHegemon", data: { name: String(slew.data.name ?? "") } };
  const shadow = highlights.find((h) => h.code === "hegemonRout" || h.code === "hegemonKneel" || h.code === "hegemonTribute");
  if (shadow) return { code: "epiSurvivedShadow", data: { name: String(shadow.data.name ?? "") } };
  if (highlights.some((h) => h.code === "prophecyFulfilled")) return { code: "epiProphecy", data: {} };
  if (kind === "prosperity") return { code: "epiGoldenAge", data: {} };
  return { code: "epiEndured", data: {} };
}

// StS ladder, derived — wins on this seed raise its difficulty; defeats never punish a retry.
export function ascensionLevel(entries: LegacyEntry[]): number {
  return Math.min(ASCENSION_CAP, entries.filter((e) => e.kind !== "defeat").length);
}
