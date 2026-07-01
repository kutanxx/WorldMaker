import { describe, it, expect } from "vitest";
import { mulberry32 } from "../rng";
import type { WardCell } from "./wards";
import { assignZones } from "./zoning";
import type { Point } from "../geometry";

function ringWards(n: number): WardCell[] {
  const out: WardCell[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = 20 + (i % 3) * 30;
    const site: Point = [150 + Math.cos(a) * r, 150 + Math.sin(a) * r];
    out.push({ site, polygon: [[site[0] - 5, site[1] - 5], [site[0] + 5, site[1] - 5], [site[0] + 5, site[1] + 5], [site[0] - 5, site[1] + 5]] });
  }
  return out;
}

describe("zoning.assignZones", () => {
  it("assigns exactly one plaza (the most central ward)", () => {
    const z = assignZones(mulberry32(1), ringWards(14), [150, 150], 100, { hasCastle: true, coastal: false });
    expect(z.filter((w) => w.type === "plaza").length).toBe(1);
  });
  it("places a castle when hasCastle is true", () => {
    const z = assignZones(mulberry32(2), ringWards(14), [150, 150], 100, { hasCastle: true, coastal: false });
    expect(z.some((w) => w.type === "castle")).toBe(true);
  });
  it("omits castle when hasCastle is false", () => {
    const z = assignZones(mulberry32(2), ringWards(14), [150, 150], 100, { hasCastle: false, coastal: false });
    expect(z.some((w) => w.type === "castle")).toBe(false);
  });
  it("adds a harbor only when coastal", () => {
    const dry = assignZones(mulberry32(3), ringWards(14), [150, 150], 100, { hasCastle: true, coastal: false });
    const wet = assignZones(mulberry32(3), ringWards(14), [150, 150], 100, { hasCastle: true, coastal: true });
    expect(dry.some((w) => w.type === "harbor")).toBe(false);
    expect(wet.some((w) => w.type === "harbor")).toBe(true);
  });
  it("marks central wards inner and far wards outer", () => {
    const z = assignZones(mulberry32(4), ringWards(14), [150, 150], 100, { hasCastle: true, coastal: false });
    const plaza = z.find((w) => w.type === "plaza")!;
    expect(plaza.inner).toBe(true);
    const far = z.find((w) => w.dist > 60)!;
    expect(far.inner).toBe(false);
  });
  it("anchors the castle toward the high ground when castleAnchor is given", () => {
    const wards = ringWards(14);
    const anchor: Point = [40, 150]; // far left (a mountain side)
    const z = assignZones(mulberry32(5), wards, [150, 150], 100, { hasCastle: true, coastal: false, castleAnchor: anchor });
    const castle = z.find((w) => w.type === "castle")!;
    // the castle ward is the not-plaza/cathedral/guildhall ward nearest the anchor
    const dCastle = Math.hypot(castle.site[0] - anchor[0], castle.site[1] - anchor[1]);
    const used = new Set(["plaza", "cathedral", "guildhall"]);
    for (const w of z) {
      if (w === castle || used.has(w.type)) continue;
      expect(dCastle).toBeLessThanOrEqual(Math.hypot(w.site[0] - anchor[0], w.site[1] - anchor[1]) + 1e-6);
    }
  });
});
