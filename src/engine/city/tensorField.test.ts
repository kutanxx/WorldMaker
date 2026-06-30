import { describe, it, expect } from "vitest";
import { mulberry32 } from "../rng";
import { makeTensorField } from "./tensorField";
import type { BasisField } from "./tensorField";

const grid: BasisField[] = [{ kind: "grid", center: [150, 150], size: 400, decay: 1, theta: 0 }];

describe("tensorField", () => {
  it("a grid field at theta=0 yields a near-horizontal major direction", () => {
    const tf = makeTensorField(mulberry32(1), grid, 0);
    const m = tf.major([150, 150]);
    expect(Math.abs(m[1])).toBeLessThan(0.2);
    expect(Math.abs(m[0])).toBeGreaterThan(0.8);
  });
  it("minor is perpendicular to major", () => {
    const tf = makeTensorField(mulberry32(1), grid, 0);
    const m = tf.major([120, 140]);
    const n = tf.minor([120, 140]);
    expect(Math.abs(m[0] * n[0] + m[1] * n[1])).toBeLessThan(1e-6);
  });
  it("direction is continuous between nearby points", () => {
    const tf = makeTensorField(mulberry32(2), [{ kind: "radial", center: [150, 150], size: 200, decay: 1, theta: 0 }], 0);
    const m1 = tf.major([100, 150]);
    const m2 = tf.major([103, 150]);
    expect(Math.abs(m1[0] * m2[0] + m1[1] * m2[1])).toBeGreaterThan(0.9);
  });
  it("is deterministic", () => {
    const a = makeTensorField(mulberry32(5), grid).major([130, 160]);
    const b = makeTensorField(mulberry32(5), grid).major([130, 160]);
    expect(a).toEqual(b);
  });
});
