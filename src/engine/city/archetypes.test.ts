import { describe, it, expect } from "vitest";
import { mulberry32 } from "../rng";
import { selectArchetype } from "./archetypes";

describe("archetypes", () => {
  it("picks coastalPort for a coastal low city", () => {
    const a = selectArchetype({ coastal: true, elevation: 0.35, size: 4 }, mulberry32(1));
    expect(a.id).toBe("coastalPort");
    expect(a.water).toBe("sea");
  });
  it("picks hilltopFortress for a high inland city", () => {
    const a = selectArchetype({ coastal: false, elevation: 0.78, size: 4 }, mulberry32(1));
    expect(a.id).toBe("hilltopFortress");
    expect(a.wallShape).toBe("contour");
  });
  it("is deterministic", () => {
    const o = { coastal: false, elevation: 0.5, size: 3 };
    expect(selectArchetype(o, mulberry32(9))).toEqual(selectArchetype(o, mulberry32(9)));
  });
  it("inland mid cities vary by seed across river/plains/ridge types", () => {
    const ids = new Set<string>();
    for (let s = 0; s < 30; s++) {
      ids.add(selectArchetype({ coastal: false, elevation: 0.5, size: 3 }, mulberry32(s)).id);
    }
    expect(ids.size).toBeGreaterThan(1);
  });
});
