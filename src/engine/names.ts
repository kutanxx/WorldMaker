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

// Two drawn tokens meeting must not double a letter. A doubling INSIDE a token — the "aa" of a
// guttural vowel, the "gg" of its coda — is the profile's own voice and is kept; the same letters
// arriving from two different tokens is an accident of the draw, and it is what produced names no
// reader could say: `Saaarsiiaz` came from onset "sa" meeting vowel "aa", `Naanlyan` from vowel "a"
// meeting coda "an", neither of which any profile asked for.
function join(acc: string, tok: string): string {
  if (!acc || !tok) return acc + tok;
  return acc[acc.length - 1] === tok[0] ? acc + tok.slice(1) : acc + tok;
}

// Last line of defence, for runs no single join created: a profile that puts "gg" in both onset and
// coda can still stack them across a syllable. Three of the same letter is past what a reader will
// attempt, so collapse to two — which leaves the doubling that carries the culture's sound intact.
function collapseRuns(w: string): string {
  return w.replace(/(.)\1{2,}/g, "$1$1");
}

// Names are REPAIRED, never redrawn. `names.test.ts` pins the invariant that a phonetic profile
// changes the string but not how many numbers come off the rng — every city placed after a name is
// drawn would shift otherwise, so a retry loop would silently move the map around. Repair is pure
// string work and consumes nothing.
export function makeNameGen(rng: Rng, phon: Phonetics = DEFAULT_PHON): NameGen {
  const syl = () => {
    let w = join(pick(rng, phon.onset), pick(rng, phon.vowel));
    return join(w, pick(rng, phon.coda));
  };
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const word = (a: string, b: string) => cap(collapseRuns(join(a, b)));
  return {
    // The second syllable is still drawn on a coin-flip; `join` with "" is a no-op, so an empty
    // second half costs the same draws it always did.
    place: () => word(syl(), rng() < 0.5 ? syl() : ""),
    nation: () => word(syl(), syl()),
  };
}
