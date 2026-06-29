import { describe, it, expect } from "vitest";
import { DEFAULT_PARAMS } from "../types/world";
import { encodeParams, decodeParams } from "./urlState";

describe("urlState", () => {
  it("round-trips params", () => {
    const p = { ...DEFAULT_PARAMS, seed: 1234, polityCount: 5 };
    expect(decodeParams(encodeParams(p))).toEqual(p);
  });
  it("falls back to defaults on garbage", () => {
    expect(decodeParams("#not-valid")).toEqual(DEFAULT_PARAMS);
    expect(decodeParams("")).toEqual(DEFAULT_PARAMS);
  });
});
