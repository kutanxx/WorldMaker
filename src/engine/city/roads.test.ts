import { describe, it, expect } from "vitest";
import { buildRoads } from "./roads";

describe("roads", () => {
  it("creates one road per gate plus a ring, each ending near the plaza", () => {
    const gates: [number, number][] = [[60, 150], [240, 150], [150, 60]];
    const roads = buildRoads([150, 150], gates);
    expect(roads.length).toBe(gates.length + 1);
    for (let i = 0; i < gates.length; i++) {
      const r = roads[i];
      const last = r[r.length - 1];
      expect(Math.hypot(last[0] - 150, last[1] - 150)).toBeLessThan(40);
      expect(r[0]).toEqual(gates[i]);
    }
  });
});
