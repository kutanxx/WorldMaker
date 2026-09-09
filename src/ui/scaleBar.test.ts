// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { scaleBar, KM_PER_UNIT, METRES_PER_UNIT, KM_PER_WALKING_DAY } from "./scaleBar";

// The maps are for running a game at a table, and neither of them said how far anything was.
describe("the maps say how far", () => {
  it("rules a bar of the length it claims", () => {
    const g = scaleBar(100, 600, 120, "360 km");
    const chain = [...g.querySelectorAll("rect")].slice(1);   // the first rect is the backing
    expect(chain.length).toBe(4);
    const left = Math.min(...chain.map((r) => Number(r.getAttribute("x"))));
    const right = Math.max(...chain.map((r) => Number(r.getAttribute("x")) + Number(r.getAttribute("width"))));
    expect(right - left).toBeCloseTo(120, 6);
    expect(left).toBeCloseTo(100, 6);
    expect(g.querySelector("text")?.textContent).toBe("360 km");
  });

  it("keeps a town the size a walled town was", () => {
    // the wall's radius is 60 + 12*size, so a size-3 market town is 192 units across
    expect(192 * METRES_PER_UNIT).toBeGreaterThan(400);
    expect(264 * METRES_PER_UNIT).toBeLessThan(1200);
  });

  it("leaves neighbouring towns a walk apart, not a voyage", () => {
    // measured: the closest pair of cities on a map is about 9 units, the usual spacing far more
    const closest = 9 * KM_PER_UNIT / KM_PER_WALKING_DAY;
    expect(closest).toBeLessThan(1.5);   // under two days
    expect(closest).toBeGreaterThan(0.5); // and not next door
  });
});
