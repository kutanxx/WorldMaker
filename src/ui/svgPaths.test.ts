import { describe, it, expect } from "vitest";
import { cellPath, segPath } from "./svgPaths";

describe("svgPaths", () => {
  it("cellPath builds a closed path and returns '' for an empty polygon", () => {
    expect(cellPath([[0, 0], [2, 0], [2, 2]])).toBe("M0.0,0.0L2.0,0.0L2.0,2.0Z");
    expect(cellPath([])).toBe("");
  });
  it("segPath emits one M..L.. per segment", () => {
    expect(segPath([[[0, 0], [1, 1]]])).toBe("M0.0,0.0L1.0,1.0");
  });
});
