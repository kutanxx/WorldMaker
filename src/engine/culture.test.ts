import { describe, it, expect } from "vitest";
import { mulberry32 } from "./rng";
import { assignCultures, CULTURE_PROFILES } from "./culture";

function grid(n: number) {
  const points: number[] = [];
  for (let i = 0; i < n; i++) points.push((i % 10) * 30, Math.floor(i / 10) * 30);
  return { count: n, points };
}

describe("assignCultures", () => {
  it("gives every land cell a valid culture and leaves ocean at -1", () => {
    const n = 100, g = grid(n);
    const terrain = new Array(n).fill(1);
    terrain[0] = terrain[1] = 0; // 2 ocean cells
    const { cultureOf, cultures } = assignCultures(mulberry32(1), g, terrain, 4);
    expect(cultures.length).toBeGreaterThanOrEqual(1);
    expect(cultures.length).toBeLessThanOrEqual(4);
    for (let i = 0; i < n; i++) {
      if (terrain[i] === 0) expect(cultureOf[i]).toBe(-1);
      else { expect(cultureOf[i]).toBeGreaterThanOrEqual(0); expect(cultureOf[i]).toBeLessThan(cultures.length); }
    }
  });
  it("is deterministic and respects count", () => {
    const n = 100, g = grid(n), terrain = new Array(n).fill(1);
    const a = assignCultures(mulberry32(2), g, terrain, 3);
    const b = assignCultures(mulberry32(2), g, terrain, 3);
    expect(Array.from(a.cultureOf)).toEqual(Array.from(b.cultureOf));
    expect(a.cultures.map((c) => c.name)).toEqual(b.cultures.map((c) => c.name));
    expect(a.cultures.length).toBe(3);
  });
  it("ships distinct phonetic profiles", () => {
    const sigs = CULTURE_PROFILES.map((p) => p.phon.onset.join(","));
    expect(new Set(sigs).size).toBe(CULTURE_PROFILES.length);
  });
});
