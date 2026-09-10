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
// Lowered 11 -> 10 once the real names were measured beside these: 4% of fifty real place names run
// to ten letters (Alexandria, Strasbourg) and none go past it, against 17.2% of these. Eleven was
// set by what this generator happened to produce, not by what a reader will retype.
// ⚠ NOT nine, which was tried first and was worse: a cap under the natural length of two syllables
// amputates instead of shortening — Dhaishdhar became Dhaishdha, Staethfoum became Staethfou, words
// that read as cut off rather than as short. Ten is where real names stop, and it is also exactly
// what two of this generator's syllables come to once their codas are shed, so nothing is cut.
const MAX_LEN = 10;

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

// A reader counts SOUNDS, not letters: `th`, `sh`, `kh` and `gg` are one consonant each, and a rule
// that called Thorne a four-consonant pile-up would go after the wrong names. Everything below is
// measured in these units.
const DIGRAPHS = ["th", "sh", "kh", "dh", "ch", "gg", "ck", "ph"];
const VOWELS = "aeiouy";                 // y is a vowel in these profiles: Thykhy, Svafo, sy-, ly-

// What real place names do, and what this generator did not. Measured over twenty seeds and 4,128
// invented words against fifty real ones (London, Trondheim, Samarkand, Ephesus): no real name in
// the sample piles four consonants or three vowels, while 3.5% and 16.7% of these did.
const MAX_CLUSTER = 3;                   // 3 is Strasbourg, and 12% of the real sample reaches it
const MAX_VOWELS = 2;

function unitAt(w: string, i: number, back: boolean): string {
  const two = back ? w.slice(i - 2, i).toLowerCase() : w.slice(i, i + 2).toLowerCase();
  return two.length === 2 && DIGRAPHS.includes(two) ? two : (back ? w[i - 1] : w[i]).toLowerCase();
}
const isVowelUnit = (u: string) => u.length === 1 && VOWELS.includes(u);

/** How many units of the wanted class the word ends with (`back`) or the token begins with. */
function edgeUnits(w: string, vowels: boolean, back: boolean): number {
  let i = back ? w.length : 0, n = 0;
  while (back ? i > 0 : i < w.length) {
    const u = unitAt(w, i, back);
    if (isVowelUnit(u) !== vowels) break;
    n++; i += back ? -u.length : u.length;
  }
  return n;
}
const dropEdge = (w: string, back: boolean) =>
  back ? w.slice(0, w.length - unitAt(w, w.length, true).length) : w.slice(unitAt(w, 0, false).length);

// Where the unreadable names were actually made: the seam. Two tokens are drawn and glued, and
// nothing ever looked at what the gluing produced — coda `rk` meeting onset `gru` gives `rkgru`,
// which no English word has, and vowel `ae` meeting `io` gives a four-vowel smear. Both are
// accidents of the draw rather than anything a profile asked for, so both are repaired here.
//
// The repair is pure string work and draws NOTHING. That is the law this file lives under: a name
// that needed fixing must not cost an extra rng value, or every city placed after it shifts and the
// map moves. Which is also why each side sheds what it can spare rather than being redrawn — the
// coda is the part a name can lose and still sound like itself (Draurk|gruaagr -> Draurgruaa), and
// on the vowel side it is the arriving token that gives way.
function weld(acc: string, tok: string): string {
  if (!acc || !tok) return acc + tok;
  let a = acc, t = tok;
  if (a[a.length - 1] === t[0]) t = t.slice(1);           // the doubled-letter rule, unchanged
  if (!t) return a;
  while (edgeUnits(a, false, true) > 0
      && edgeUnits(a, false, true) + edgeUnits(t, false, false) > MAX_CLUSTER) {
    const trimmed = dropEdge(a, true);
    if (!new RegExp(`[${VOWELS}]`, "i").test(trimmed)) break;   // never leave a word with no vowel
    a = trimmed;
  }
  while (t && edgeUnits(t, true, false) > 0
      && edgeUnits(a, true, true) + edgeUnits(t, true, false) > MAX_VOWELS) {
    t = dropEdge(t, false);
  }
  // Trimming can uncover a doubled letter the seam rule already walked past: `...li` meeting `ei`
  // passes it (i vs e), then the vowel cap drops the `e` and the seam becomes `lii` — Vaathlii,
  // Kaargruu, names that read as typos rather than as words. So the seam rule is asked again, of
  // the letters that actually ended up next to each other.
  return join(a, t);
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
    body: weld(pick(rng, phon.onset), pick(rng, phon.vowel)),
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
          ? weld(out, codas[(dig(out, guard) + k) % codas.length])
          : weld(weld(out, phon.vowel[(dig(out, guard) + k) % phon.vowel.length]), codas[(dig(out, guard + 97) + k) % codas.length]);
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
        w = weld(w, parts[i].body);
        if (i < parts.length - drop) w = weld(w, parts[i].coda);
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
    // A guard, not a rule: with every coda shed, two syllables cannot exceed the cap, so this does
    // not fire on any of the five profiles. It is here so that a future table cannot quietly break
    // the promise the tests make about length — and it cuts at a unit boundary, never through a
    // digraph.
    let w = lengthen(deStutter(build(parts.length)));
    while (w.length > MAX_LEN && w.length > MIN_LEN) w = dropEdge(w, true);
    return cap(w);
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
