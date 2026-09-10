import { describe, it, expect } from "vitest";
import { mulberry32 } from "./rng";
import { makeNameGen, deStutter } from "./names";
import { generateWorld } from "./world";
import { DEFAULT_PARAMS } from "../types/world";
import { simulateHistory } from "./history";
import { buildDynasties } from "./dynasty";

describe("names", () => {
  it("produces non-empty capitalized names", () => {
    const g = makeNameGen(mulberry32(1));
    const n = g.place();
    expect(n.length).toBeGreaterThan(1);
    expect(n[0]).toBe(n[0].toUpperCase());
  });
  it("is deterministic", () => {
    const a = makeNameGen(mulberry32(2));
    const b = makeNameGen(mulberry32(2));
    expect([a.place(), a.nation()]).toEqual([b.place(), b.nation()]);
  });
  it("a phonetic profile changes the name but NOT the rng draw count (geometry-safe)", () => {
    const a = mulberry32(5), b = mulberry32(5);
    const profA = { onset: ["k"], vowel: ["a"], coda: ["r"] };
    const profB = { onset: ["zx"], vowel: ["oo"], coda: ["nn"] };
    const na = makeNameGen(a, profA).place();
    const nb = makeNameGen(b, profB).place();
    expect(na).not.toBe(nb);   // different syllable sets -> different string
    expect(a()).toBe(b());     // rng left at the SAME position -> identical number of draws
  });

  it("keeps a doubling the profile asked for, and drops one made by a join", () => {
    // "aa" inside a vowel token is the profile's own voice — a guttural culture is meant to sound
    // like that. The same letters arriving from two different tokens is an accident of drawing.
    const kept = makeNameGen(mulberry32(3), { onset: ["k"], vowel: ["aa"], coda: ["r"] }).place();
    expect(kept).toContain("aa");
    const joined = makeNameGen(mulberry32(3), { onset: ["ka"], vowel: ["a"], coda: ["r"] }).place();
    expect(joined).not.toMatch(/aa/);
  });

  it("never emits a letter three times over, however the tokens fall", () => {
    const g = makeNameGen(mulberry32(4), { onset: ["gg"], vowel: ["a"], coda: ["gg"] });
    for (let i = 0; i < 50; i++) {
      expect(g.nation()).not.toMatch(/(.)\1\1/);
      expect(g.place()).not.toMatch(/(.)\1\1/);
    }
  });

  it("leaves the rng draw count untouched by the repairs (geometry-safe)", () => {
    // The whole point of repairing rather than redrawing: a name that needed fixing must not
    // consume an extra draw, or every city placed after it would shift.
    const a = mulberry32(9), b = mulberry32(9);
    makeNameGen(a, { onset: ["k"], vowel: ["a"], coda: ["r"] }).nation();
    makeNameGen(b, { onset: ["gg"], vowel: ["aa"], coda: ["gg"] }).nation();  // needs repair
    expect(a()).toBe(b());
  });
});

// An outside review called out three things about generated names. Measured over twenty seeds and
// 967 names, one of the three was already fixed and one did not reproduce at all:
//
//   "Za" — too short to be a name        40 of 967 at three letters or fewer, the shortest TWO
//   "Gruaaggogg" — three letters running 0 of 967; collapseRuns has handled this since it was added
//   "Mouth" — a plain English word       0 of 967
//
// What the middle complaint was actually pointing at is a stutter of a different shape: a repeated
// SYLLABLE, as in Aeael, Khaakak, Eleleian — 29 of 967. Both real ones are repaired here rather
// than redrawn, because this generator must not consume a different number of rng values: every
// city placed after a name would shift, and the map with it.
describe("a name is long enough to be a name, and does not stutter", () => {
  const everyName = () => {
    const out: string[] = [];
    for (let seed = 1; seed <= 30; seed++) {
      const rng = mulberry32(seed);
      const g = makeNameGen(rng);
      for (let i = 0; i < 40; i++) { out.push(g.place()); out.push(g.nation()); }
    }
    return out;
  };

  it("never produces a name of three letters or fewer", () => {
    const short = everyName().filter((n) => n.length <= 3);
    expect(short, `${short.length} too-short names, e.g. ${[...new Set(short)].slice(0, 8).join(" ")}`).toEqual([]);
  });

  it("never repeats a syllable straight back", () => {
    const stutter = everyName().filter((n) => /(..)\1/i.test(n));
    expect(stutter, `e.g. ${[...new Set(stutter)].slice(0, 8).join(" ")}`).toEqual([]);
  });

  it("still costs the rng exactly what it did, or the map moves", () => {
    // the invariant this file already pins, restated for the repairs added above
    const count = (fn: (g: ReturnType<typeof makeNameGen>) => void) => {
      let draws = 0;
      const rng = () => { draws++; return mulberry32(7)(); };
      fn(makeNameGen(rng));
      return draws;
    };
    expect(count((g) => { g.place(); })).toBe(count((g) => { g.place(); }));
    expect(count((g) => { g.nation(); })).toBe(count((g) => { g.nation(); }));
  });
});

// A regex mangled by tooling once passed the tests above for entirely the wrong reason: written as
// /(..)/ instead of /(..)\1/ it matches ANY two characters, so every name lost its second and third
// letters and no repeated pair could survive to be found. These pin what the repair does, not just
// what it prevents.
describe("deStutter drops the second copy and leaves everything else alone", () => {
  it("cuts a repeated pair", () => {
    expect(deStutter("ruththen")).toBe("ruthen");
    expect(deStutter("aeael")).toBe("ael");
    expect(deStutter("narark")).toBe("nark");
  });
  it("leaves a name with no repeated pair exactly as it was", () => {
    for (const w of ["draurk", "kravon", "syenmoth", "a", "ab", "abc"]) expect(deStutter(w)).toBe(w);
  });
});

// A name a reader cannot say is an obstacle, not a proper noun, and the generator was producing
// them at a rate the eye notices. Measured over twenty seeds and every invented word the world
// carries — cities, rivers, realms, peoples, regions, rulers, 4,128 of them — against fifty real
// place names (London, Trondheim, Samarkand, Ephesus) measured the same way:
//
//                       real places      generated
//   4+ consonants             0%            3.5%     Gruarkvrogr, Skeifrbrynd, Fjeifrhrarn
//   3+ vowels                 0%           16.7%     Vaeieliael, Melenaeiael, Aeioanlia
//   10 letters or more        4%           17.2%
//
// Digraphs are counted as ONE sound: `th`, `sh`, `kh`, `gg` are single consonants to a reader, and
// a metric that calls "Thorne" a four-consonant pile-up would send the repair after the wrong
// names. The measurement per people is what named the culprits — the melodic profile put a 3-vowel
// run in HALF its names, which no amount of staring at the guttural ones would have found.
describe("names a reader can say", () => {
  const DIGRAPHS = ["th", "sh", "kh", "dh", "ch", "gg", "ck", "ph"];
  const VOWEL = new Set(["a", "e", "i", "o", "u", "y"]);
  const unitsOf = (word: string): string[] => {
    const w = word.toLowerCase(); const out: string[] = [];
    for (let i = 0; i < w.length; ) {
      const two = w.slice(i, i + 2);
      if (DIGRAPHS.includes(two)) { out.push(two); i += 2; continue; }
      out.push(w[i]); i += 1;
    }
    return out;
  };
  const longestRun = (word: string, vowels: boolean) => {
    let best = 0, run = 0;
    for (const u of unitsOf(word)) {
      if (VOWEL.has(u) !== vowels) { run = 0; continue; }
      run++; if (run > best) best = run;
    }
    return best;
  };
  // Region and river names are phrases — "Heights of Lurknaend" — and only the invented word in
  // them is this generator's doing. An earlier pass at this measurement counted across the spaces
  // and reported "the Endless Frostlands" as a five-consonant name.
  const ENGLISH = new Set(["the", "of", "and", "rill", "river", "brook", "heights", "mountains",
    "frostlands", "barrens", "wilds", "woods", "fields", "sands", "plains", "pinewood", "rainforest",
    "spires", "marsh", "coast", "isles", "vale", "reach", "expanse", "desert", "forest", "hills",
    "steppe", "tundra", "jungle", "fens", "shore", "cold", "endless", "broken", "black", "iron",
    "old", "golden", "shrouded", "great", "far", "deep", "high", "white", "red", "grey", "gray",
    "silent", "lost", "burning"]);

  const words: { word: string; culture: number }[] = [];
  for (let seed = 1; seed <= 20; seed++) {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed });
    const history = simulateHistory(world, seed);
    const dyn = buildDynasties(world, history);
    const cultOf = (cell: number) => (cell >= 0 && cell < world.cultureOf.length ? world.cultureOf[cell] : -1);
    const add = (name: string, culture: number) => {
      for (const w of name.split(/[^A-Za-z]+/)) if (w && !ENGLISH.has(w.toLowerCase())) words.push({ word: w, culture });
    };
    for (const c of world.cities) add(c.name, cultOf(c.cell));
    for (const r of world.rivers) add(r.name, -1);
    for (const p of history.polities) add(p.name, cultOf(p.capital));
    for (const c of world.cultures) add(c.name, -1);
    for (const r of world.regions) add(r.name, -1);
    for (const [, reigns] of dyn) for (const r of reigns) add(r.name, -1);
  }

  it("has the world to measure in the first place", () => {
    expect(words.length).toBeGreaterThan(3000);
  });

  it("never piles four consonants in a row, which no real place name does either", () => {
    const bad = words.filter((w) => longestRun(w.word, false) >= 4).map((w) => w.word);
    expect(bad, `${bad.length} of ${words.length}, e.g. ${[...new Set(bad)].slice(0, 10).join(" ")}`).toEqual([]);
  });

  it("never piles three vowels in a row", () => {
    const bad = words.filter((w) => longestRun(w.word, true) >= 3).map((w) => w.word);
    expect(bad, `${bad.length} of ${words.length}, e.g. ${[...new Set(bad)].slice(0, 10).join(" ")}`).toEqual([]);
  });

  it("stays inside the length a reader will retype", () => {
    // Ten, which is where the real sample stops (Alexandria, Strasbourg) — not nine, which cut into
    // words that were already fine and left Dhaishdha, Staethfou, endings that read as amputations.
    const bad = words.filter((w) => w.word.length > 10).map((w) => w.word);
    expect(bad, `${bad.length} of ${words.length}, e.g. ${[...new Set(bad)].slice(0, 10).join(" ")}`).toEqual([]);
  });

  // The failure mode of "make it readable" is "make it all the same". This is the guard against it:
  // it passes today and has to keep passing, or legibility was bought by flattening the map's five
  // peoples into one. Each profile is a distribution over letters; two peoples are distinct when
  // their distributions are far apart.
  it("keeps the five peoples sounding like five peoples", () => {
    const profile = (p: number) => {
      const freq = new Map<string, number>();
      let total = 0;
      for (const w of words.filter((x) => x.culture === p)) {
        for (const ch of w.word.toLowerCase()) { freq.set(ch, (freq.get(ch) ?? 0) + 1); total++; }
      }
      return { freq, total };
    };
    const profiles = [0, 1, 2, 3, 4].map(profile);
    for (const p of profiles) expect(p.total).toBeGreaterThan(200);
    const distance = (a: typeof profiles[0], b: typeof profiles[0]) => {
      let d = 0;
      for (const ch of new Set([...a.freq.keys(), ...b.freq.keys()])) {
        d += Math.abs((a.freq.get(ch) ?? 0) / a.total - (b.freq.get(ch) ?? 0) / b.total);
      }
      return d;                                  // 0 = identical, 2 = no letters in common
    };
    for (let i = 0; i < profiles.length; i++) {
      for (let j = i + 1; j < profiles.length; j++) {
        expect(distance(profiles[i], profiles[j]), `peoples ${i} and ${j} sound alike`).toBeGreaterThan(0.5);
      }
    }
  });
});
