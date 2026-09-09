import { describe, it, expect } from "vitest";
import { mulberry32 } from "./rng";
import { makeNameGen, deStutter } from "./names";

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
