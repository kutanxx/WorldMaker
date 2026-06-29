import { describe, it, expect } from "vitest";
import { mulberry32, randInt, pick, hashStringToSeed, deriveSeed } from "./rng";

describe("rng", () => {
  it("is deterministic for the same seed", () => {
    const a = mulberry32(42), b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
  it("differs across seeds", () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
  it("randInt stays in range", () => {
    const r = mulberry32(7);
    for (let i = 0; i < 200; i++) {
      const v = randInt(r, 3, 9);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(9);
    }
  });
  it("pick returns an element", () => {
    expect(["x", "y"]).toContain(pick(mulberry32(5), ["x", "y"]));
  });
  it("pick throws on an empty array", () => {
    expect(() => pick(mulberry32(1), [])).toThrow();
  });
  it("hashStringToSeed and deriveSeed are deterministic", () => {
    expect(hashStringToSeed("abc")).toBe(hashStringToSeed("abc"));
    expect(deriveSeed(10, 3)).toBe(deriveSeed(10, 3));
    expect(deriveSeed(10, 3)).not.toBe(deriveSeed(10, 4));
  });
});
