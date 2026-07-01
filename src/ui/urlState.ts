import type { WorldParams } from "../types/world";
import { DEFAULT_PARAMS } from "../types/world";

const KEYS = Object.keys(DEFAULT_PARAMS) as (keyof WorldParams)[];

export function encodeParams(p: WorldParams): string {
  return "#" + btoa(JSON.stringify(p));
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000);
}

// A shared URL seed wins; otherwise start on a fresh RANDOM seed (not always seed 1).
export function initialParams(hash: string): WorldParams {
  return hash.replace(/^#/, "").length > 0
    ? decodeParams(hash)
    : { ...DEFAULT_PARAMS, seed: randomSeed() };
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
