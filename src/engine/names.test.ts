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
});
