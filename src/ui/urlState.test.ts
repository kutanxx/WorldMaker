import { describe, it, expect } from "vitest";
import { DEFAULT_PARAMS } from "../types/world";
import { encodeParams, decodeParams, initialParams, randomSeed } from "./urlState";

describe("urlState", () => {
  it("round-trips params", () => {
    const p = { seed: 1234, width: 800, height: 600, cellCount: 1500, seaLevel: 0.35, mountainLevel: 0.82, polityCount: 5, townCount: 12 };
    expect(decodeParams(encodeParams(p))).toEqual(p);
  });
  it("falls back to defaults on garbage", () => {
    expect(decodeParams("#not-valid")).toEqual(DEFAULT_PARAMS);
    expect(decodeParams("")).toEqual(DEFAULT_PARAMS);
  });
  it("randomSeed returns a finite non-negative integer that varies", () => {
    const seeds = new Set(Array.from({ length: 20 }, () => randomSeed()));
    for (const s of seeds) { expect(Number.isInteger(s)).toBe(true); expect(s).toBeGreaterThanOrEqual(0); }
    expect(seeds.size).toBeGreaterThan(1); // effectively always distinct
  });
  it("initialParams honours a shared URL seed but starts random on an empty hash", () => {
    // a shared URL wins (share-a-seed is a core feature)
    const shared = { ...DEFAULT_PARAMS, seed: 4242 };
    expect(initialParams(encodeParams(shared)).seed).toBe(4242);
    // empty hash -> a fresh random seed (not forced to 1); other params stay default
    const p = initialParams("");
    expect(Number.isInteger(p.seed)).toBe(true);
    expect({ ...p, seed: 0 }).toEqual({ ...DEFAULT_PARAMS, seed: 0 });
  });
});
