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
// The name a world was ASKED for, when the link carried one. The landing page invites the reader
// to "start from a name" and then used it only as a seed and threw it away: an outside review typed
// "아발론" and got back a world called "The Old Lands". A number is a seed, not a name.
// The city view left no trace in the address: it could not be shared or bookmarked, and the
// browser's Back button walked out of the site instead of returning to the world map. A city rides
// alongside whichever world form the link uses — the base64 payload or the readable name — as a
// plain `&city=<id>` on the end, so both keep decoding exactly as they did.
const CITY = /(?:^|&)city=(\d+)(?=&|$)/;

export function initialCity(hash: string): number | null {
  const m = CITY.exec(hash.replace(/^#/, ""));
  return m ? Number(m[1]) : null;
}

export function withoutCity(hash: string): string {
  const lead = hash.startsWith("#") ? "#" : "";
  const raw = hash.replace(/^#/, "").replace(CITY, "").replace(/^&/, "");
  return lead + raw;
}

export function initialSeedName(hash: string): string | null {
  const raw = hash.replace(/^#/, "");
  if (raw.length === 0) return null;
  const v = new URLSearchParams(raw).get("seed");
  if (v === null) return null;
  const t = v.trim();
  if (t.length === 0 || /^\d+$/.test(t)) return null;
  // `daily-2026-09-09` is a machine key, not a name a reader gave the world, and using it as one
  // printed "DAILY-2026-09-09" in the cartouche where a world's name belongs. Falling through to
  // null lets the generator name the daily world the way it names a random one; the SEED is
  // untouched, since that comes from hashing the same string either way.
  if (/^daily-\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  return t;
}

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
