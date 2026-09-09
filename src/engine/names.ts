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

// ...and where it stops being a name from the other end. Measured over twenty seeds and 967 names,
// 40 came out at three letters or fewer and the shortest were TWO — "Za", "Mi". A two-letter proper
// noun reads as an abbreviation, not a place.
const MIN_LEN = 4;

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

// A number taken from the letters a name already has, so a repair is decided by the name itself.
// Nothing here may touch the rng: this generator must consume the same count whatever it produces,
// or every city placed after a name shifts and the map moves with it.
function dig(w: string, salt = 0): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < w.length; i++) h = Math.imul(h ^ w.charCodeAt(i), 16777619) >>> 0;
  return (h ^ salt) >>> 0;
}

// A syllable said straight back: Aeael, Khaakak, Ruththen, Narark — 29 of 967 measured. `join` and
// `collapseRuns` catch a doubled LETTER; this is a doubled pair, which arrives when two drawn
// tokens happen to be the same. The second copy is dropped, which is the smallest repair that
// always terminates and leaves the name sounding like itself.
export function deStutter(w: string): string {
  for (let guard = 0; guard < 4; guard++) {
    const m = /(..)\1/i.exec(w);
    if (!m) break;
    w = w.slice(0, m.index + 2) + w.slice(m.index + 4);
  }
  return w;
}

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

  // A name too short to be a name grows from its own profile — a coda, then a vowel and a coda —
  // chosen by the letters already drawn rather than by a new draw.
  const codas = phon.coda.filter((c) => c.length > 0);
  const lengthen = (w: string): string => {
    let out = w;
    for (let guard = 0; out.length < MIN_LEN && guard < 4; guard++) {
      // Candidates are walked rather than taken: growing "li" by its own vowel makes "lili", which
      // is the very stutter the previous repair just removed. The first addition that does not
      // start one wins; the hash only decides where the walk begins.
      let grown = out;
      for (let k = 0; k < codas.length; k++) {
        const cand = /[aeiou]$/i.test(out)
          ? join(out, codas[(dig(out, guard) + k) % codas.length])
          : join(join(out, phon.vowel[(dig(out, guard) + k) % phon.vowel.length]), codas[(dig(out, guard + 97) + k) % codas.length]);
        const clean = collapseRuns(cand);
        if (clean !== out && deStutter(clean) === clean) { grown = clean; break; }
        if (grown === out && clean !== out) grown = deStutter(clean); // fall back to the repaired form
      }
      if (grown === out) break;   // the profile has nothing left to add
      out = grown;
    }
    return out;
  };

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
    // repaired in the order the repairs constrain each other: the stutter is cut first (which can
    // leave the word short), then the word is grown to a readable length, and only then is the
    // length cap consulted — a grown name is still well under it.
    for (let drop = 0; drop < parts.length; drop++) {
      const w = lengthen(deStutter(build(drop)));
      if (w.length <= MAX_LEN) return cap(w);
    }
    return cap(lengthen(deStutter(build(parts.length))));
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
