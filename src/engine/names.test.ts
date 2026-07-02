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
});
