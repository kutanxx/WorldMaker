import type { Rng } from "./rng";
import { pick } from "./rng";

export interface Phonetics { onset: string[]; vowel: string[]; coda: string[] }

// the original set is the default profile (unchanged draw structure)
export const DEFAULT_PHON: Phonetics = {
  onset: ["br", "th", "k", "v", "d", "m", "s", "tr", "gl", "r", "n", "f", "l", "st"],
  vowel: ["a", "e", "i", "o", "u", "ae", "ia", "ou"],
  coda: ["n", "r", "th", "l", "s", "m", "nd", "rk", ""],
};

export interface NameGen {
  place(): string;
  nation(): string;
}

export function makeNameGen(rng: Rng, phon: Phonetics = DEFAULT_PHON): NameGen {
  const syl = () => pick(rng, phon.onset) + pick(rng, phon.vowel) + pick(rng, phon.coda);
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  return {
    place: () => cap(syl() + (rng() < 0.5 ? syl() : "")),
    nation: () => cap(syl() + syl()),
  };
}
