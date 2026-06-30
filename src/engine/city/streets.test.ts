import { describe, it, expect } from "vitest";
import { mulberry32 } from "../rng";
import { makeTensorField } from "./tensorField";
import type { Vec } from "./tensorField";
import { generateStreets } from "./streets";

const field = () =>
  makeTensorField(mulberry32(1), [{ kind: "radial", center: [150, 150], size: 200, decay: 1, theta: 0 }], 0.1);
const opts = (dsep: number, useMinor: boolean) => ({
  dsep, dtest: dsep * 0.5, step: 3, maxLength: 200, bounds: { w: 300, h: 300 }, useMinor,
});
const noStop = () => false;

describe("streets", () => {
  it("produces multiple streamlines within bounds", () => {
    const roads = generateStreets(field(), opts(40, false), noStop, [[150, 150]]);
    expect(roads.length).toBeGreaterThan(2);
    for (const r of roads) for (const p of r) {
      expect(p[0]).toBeGreaterThanOrEqual(-1);
      expect(p[0]).toBeLessThanOrEqual(301);
    }
  });
  it("smaller dsep yields a denser network (more streets)", () => {
    const sparse = generateStreets(field(), opts(60, false), noStop, [[150, 150]]);
    const dense = generateStreets(field(), opts(25, true), noStop, [[150, 150]]);
    expect(dense.length).toBeGreaterThan(sparse.length);
  });
  it("stops streamlines inside the stop region (e.g. water)", () => {
    const inWater = (p: Vec) => p[0] > 220;
    const roads = generateStreets(field(), opts(30, false), inWater, [[150, 150]]);
    for (const r of roads) for (const p of r) expect(p[0]).toBeLessThanOrEqual(221);
  });
  it("is deterministic", () => {
    const a = generateStreets(field(), opts(40, false), noStop, [[150, 150]]);
    const b = generateStreets(field(), opts(40, false), noStop, [[150, 150]]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
