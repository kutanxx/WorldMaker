import type { Rng } from "./rng";
import { pick } from "./rng";

const ONSET = ["br", "th", "k", "v", "d", "m", "s", "tr", "gl", "r", "n", "f", "l", "st"];
const VOWEL = ["a", "e", "i", "o", "u", "ae", "ia", "ou"];
const CODA = ["n", "r", "th", "l", "s", "m", "nd", "rk", ""];

export interface NameGen {
  place(): string;
  nation(): string;
}

export function makeNameGen(rng: Rng): NameGen {
  const syl = () => pick(rng, ONSET) + pick(rng, VOWEL) + pick(rng, CODA);
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  return {
    place: () => cap(syl() + (rng() < 0.5 ? syl() : "")),
    nation: () => cap(syl() + syl()),
  };
}
