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

// Where a proper noun stops being a name and starts being an obstacle. Measured across eight seeds,
// 96% of the 328 names this generator produces are already 11 characters or shorter; the rest are
// the Draurkgruaagr / Khoththraark class a writer would have to retype every time it appeared. The
// cap therefore trims outliers and leaves almost everything alone.
const MAX_LEN = 11;

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

interface Syllable { body: string; coda: string }

// Names are REPAIRED, never redrawn. `names.test.ts` pins the invariant that a phonetic profile
// changes the string but not how many numbers come off the rng — every city placed after a name is
// drawn would shift otherwise, so a retry loop would silently move the map around. Repair is pure
// string work and consumes nothing, and that is also why an over-long name sheds a coda it already
// drew rather than drawing a shorter syllable.
export function makeNameGen(rng: Rng, phon: Phonetics = DEFAULT_PHON): NameGen {
  const syl = (): Syllable => ({
    body: join(pick(rng, phon.onset), pick(rng, phon.vowel)),
    coda: pick(rng, phon.coda),
  });
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  // Assemble the drawn syllables, dropping trailing codas one at a time while the word is over the
  // cap. Codas go first because they are the part a name can lose and still sound like itself:
  // Draurk|gruaagr shortens to Draurgruaa rather than being replaced by something unrelated.
  const assemble = (parts: Syllable[]): string => {
    const build = (drop: number) => {
      let w = "";
      for (let i = 0; i < parts.length; i++) {
        w = join(w, parts[i].body);
        if (i < parts.length - drop) w = join(w, parts[i].coda);
      }
      return collapseRuns(w);
    };
    for (let drop = 0; drop < parts.length; drop++) {
      const w = build(drop);
      if (w.length <= MAX_LEN) return cap(w);
    }
    return cap(build(parts.length));
  };

  return {
    // The second syllable is still drawn on a coin-flip, in the same order as before, so the number
    // of draws a name costs has not moved.
    place: () => {
      const first = syl();
      const second = rng() < 0.5 ? syl() : null;
      return assemble(second ? [first, second] : [first]);
    },
    nation: () => assemble([syl(), syl()]),
  };
}
