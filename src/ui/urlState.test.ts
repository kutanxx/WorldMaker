import { describe, it, expect } from "vitest";
import { DEFAULT_PARAMS } from "../types/world";
import { encodeParams, decodeParams } from "./urlState";

describe("urlState", () => {
  it("round-trips params", () => {
    const p = { seed: 1234, width: 800, height: 600, cellCount: 1500, seaLevel: 0.35, mountainLevel: 0.82, polityCount: 5, townCount: 12 };
    expect(decodeParams(encodeParams(p))).toEqual(p);
  });
  it("falls back to defaults on garbage", () => {
    expect(decodeParams("#not-valid")).toEqual(DEFAULT_PARAMS);
    expect(decodeParams("")).toEqual(DEFAULT_PARAMS);
  });
});
