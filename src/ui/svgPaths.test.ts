import { describe, it, expect } from "vitest";
import { cellPath, segPath } from "./svgPaths";

// Cell edges are wobbled (see noisyEdge.ts), so these check the SHAPE of the output rather than its
// literal text: how many subpaths there are, that a cell closes, that every corner is still visited.
describe("svgPaths", () => {
  it("cellPath builds one closed subpath and returns '' for an empty polygon", () => {
    const d = cellPath([[0, 0], [2, 0], [2, 2]]);
    expect(d.match(/M/g)!.length).toBe(1);
    expect(d.endsWith("Z")).toBe(true);
    expect(cellPath([])).toBe("");
  });

  it("cellPath still passes through every corner of the cell", () => {
    const d = cellPath([[0, 0], [2, 0], [2, 2]]);
    for (const corner of ["0.0,0.0", "2.0,0.0", "2.0,2.0"]) expect(d).toContain(corner);
  });

  it("segPath emits one subpath per segment, from its start to its end", () => {
    const d = segPath([[[0, 0], [1, 1]]]);
    expect(d.match(/M/g)!.length).toBe(1);
    expect(d.startsWith("M0.0,0.0")).toBe(true);
    expect(d.endsWith("L1.0,1.0")).toBe(true);
    expect(segPath([[[0, 0], [1, 1]], [[2, 2], [3, 3]]]).match(/M/g)!.length).toBe(2);
  });

  it("segPath leaves a segment straight when asked — rivers do not follow cell edges", () => {
    expect(segPath([[[0, 0], [1, 1]]], false)).toBe("M0.0,0.0L1.0,1.0");
  });

  // A fill and the border drawn over it must follow the same line, or the border floats off the
  // colour it is supposed to bound.
  it("draws a cell's edge and that same edge as a segment identically", () => {
    const a: [number, number] = [3, 4], b: [number, number] = [11, 9];
    const seg = segPath([[a, b]]).slice(1);                 // drop the leading M
    expect(cellPath([a, b, [20, 30]])).toContain(seg);
  });
});
