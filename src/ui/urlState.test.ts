import { describe, it, expect } from "vitest";
import { DEFAULT_PARAMS } from "../types/world";
import { encodeParams, decodeParams, initialParams, initialSeedName, randomSeed, parseSeedValue } from "./urlState";
import { hashStringToSeed } from "../engine/rng";

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
  // `parseSeedValue` was written, exported and tested — and never called by anything. So a hash
  // that was not base64 JSON fell through decodeParams' catch to DEFAULT_PARAMS, whose seed is 1:
  // every readable link (#seed=Narnia, and the daily world's own URL) silently opened world 1
  // instead of failing loudly. The reader-facing form is now the one the app understands.
  it("reads a readable seed hash, so a named world is a shareable link", () => {
    expect(initialParams("#seed=Narnia").seed).toBe(hashStringToSeed("Narnia"));
    expect(initialParams("#seed=daily-2026-07-12").seed).toBe(hashStringToSeed("daily-2026-07-12"));
    expect(initialParams("#seed=731").seed).toBe(731);           // back-compat with numeric links
    const p = initialParams("#seed=Narnia");
    expect({ ...p, seed: 0 }).toEqual({ ...DEFAULT_PARAMS, seed: 0 });  // nothing else disturbed
  });
  it("still opens a world rather than nothing when the hash is meaningless", () => {
    const p = initialParams("#not-valid");
    expect(Number.isInteger(p.seed)).toBe(true);
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

describe("parseSeedValue", () => {
  it("keeps positive integers as-is (back-compat with every existing share URL)", () => {
    expect(parseSeedValue("731")).toBe(731);
    expect(parseSeedValue(" 42 ")).toBe(42);
  });
  it("hashes any other non-empty text, deterministically — same name, same world", () => {
    expect(parseSeedValue("Narnia")).toBe(hashStringToSeed("Narnia"));
    expect(parseSeedValue("Narnia")).toBe(parseSeedValue("Narnia"));
    expect(parseSeedValue("나니아")).toBe(hashStringToSeed("나니아")); // UTF-16 names work
    expect(parseSeedValue("Narnia")).not.toBe(parseSeedValue("narnia")); // case-sensitive, like Minecraft
  });
  it("treats '0' and '-3' as text (only positive integers take the numeric path)", () => {
    expect(parseSeedValue("0")).toBe(hashStringToSeed("0"));
    expect(parseSeedValue("-3")).toBe(hashStringToSeed("-3"));
  });
  it("null/empty/whitespace → null (caller falls back to a random seed)", () => {
    expect(parseSeedValue(null)).toBeNull();
    expect(parseSeedValue("")).toBeNull();
    expect(parseSeedValue("   ")).toBeNull();
  });
});

describe("initialSeedName", () => {
  it("hands back the name a world was asked for, and nothing when it was a number", () => {
    expect(initialSeedName("#seed=Avalon")).toBe("Avalon");
    expect(initialSeedName("#seed=" + encodeURIComponent("아발론"))).toBe("아발론");
    expect(initialSeedName("#seed=731"), "a number is a seed, not a name").toBeNull();
    expect(initialSeedName(encodeParams({ ...DEFAULT_PARAMS, seed: 9 })), "a share link is not a name").toBeNull();
    expect(initialSeedName("")).toBeNull();
  });
});
