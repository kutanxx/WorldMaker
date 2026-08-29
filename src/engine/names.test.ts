import { describe, it, expect } from "vitest";
import { mulberry32 } from "./rng";
import { makeNameGen } from "./names";

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
