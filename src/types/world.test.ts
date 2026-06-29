import { describe, it, expect } from "vitest";
import { DEFAULT_PARAMS } from "./world";

describe("DEFAULT_PARAMS", () => {
  it("has sane defaults", () => {
    expect(DEFAULT_PARAMS.cellCount).toBeGreaterThan(0);
    expect(DEFAULT_PARAMS.seaLevel).toBeLessThan(DEFAULT_PARAMS.mountainLevel);
  });
});
