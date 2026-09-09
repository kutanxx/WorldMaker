import type { WorldParams } from "../types/world";
import { DEFAULT_PARAMS } from "../types/world";
import { hashStringToSeed } from "../engine/rng";

const KEYS = Object.keys(DEFAULT_PARAMS) as (keyof WorldParams)[];

export function encodeParams(p: WorldParams): string {
  return "#" + btoa(JSON.stringify(p));
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000);
}

// A seed URL value: "731" stays numeric (back-compat), any other non-empty text becomes a
// world via hashStringToSeed ("Narnia" → the same world for everyone — the Minecraft pact).
// URLSearchParams has already percent-decoded the value; never decode twice.
export function parseSeedValue(raw: string | null): number | null {
  if (raw === null) return null;
  const t = raw.trim();
  if (t.length === 0) return null;
  if (/^\d+$/.test(t)) {
    const n = Number(t);
    if (Number.isSafeInteger(n) && n > 0) return n;
  }
  return hashStringToSeed(t);
}

// A shared URL seed wins; otherwise start on a fresh RANDOM seed (not always seed 1).
//
// Two forms are read. The canonical one is the base64 payload `encodeParams` writes, which carries
// every parameter. The other is the one a person can type or read — `#seed=Narnia`,
// `#seed=daily-2026-07-12`, `#seed=731`. That second form is what `parseSeedValue` was written
// for, and nothing ever called it: a hash that was not base64 JSON fell through decodeParams'
// catch to DEFAULT_PARAMS, whose seed is 1, so every readable link quietly opened world 1 instead
// of the world it named. (The app rewrites the hash to the canonical form once it has generated,
// so the readable name lives in the link that was shared rather than in the address bar after.)
export function initialParams(hash: string): WorldParams {
  const raw = hash.replace(/^#/, "");
  if (raw.length === 0) return { ...DEFAULT_PARAMS, seed: randomSeed() };
  const named = parseSeedValue(new URLSearchParams(raw).get("seed"));
  if (named !== null) return { ...DEFAULT_PARAMS, seed: named };
  return decodeParams(hash);
}

export function decodeParams(hash: string): WorldParams {
  try {
    const json = JSON.parse(atob(hash.replace(/^#/, "")));
    const out = { ...DEFAULT_PARAMS };
    for (const k of KEYS) {
      if (typeof json[k] === "number" && Number.isFinite(json[k])) {
        (out[k] as number) = json[k];
      } else {
        return { ...DEFAULT_PARAMS };
      }
    }
    return out;
  } catch {
    return { ...DEFAULT_PARAMS };
  }
}
