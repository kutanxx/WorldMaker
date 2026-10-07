import { describe, it, expect } from "vitest";
import { cellsToKm2, formatArea, formatAreaChange } from "./area";
import { generateWorld } from "./world";
import { simulateHistory } from "./history";
import { DEFAULT_PARAMS } from "../types/world";
import { worldToGazetteer } from "./gazetteer";
import { buildChronicle } from "./chronicleLines";

// The gazetteer and the chronicle measured a realm in the map's cells — "최대 판도는 500년의 362칸",
// "(41 → 23 tiles)" — a unit of the generator's, which no reader can picture (live, 2026-10-08). The map's
// own scale (3 km to the unit, the scale bar's) makes one in square kilometres.
const p = { width: 1000, height: 700, cellCount: 4000 };

describe("an area said in square kilometres", () => {
  it("measures cells by the map's own scale: a cell of the default world is 1,575 km²", () => {
    expect(cellsToKm2(1, p)).toBe(1575);
    expect(cellsToKm2(362, p)).toBe(570150);
    expect(cellsToKm2(362, { ...p, cellCount: 8000 })).toBe(285075);
  });

  it("rounds to what a reader can hold — two figures — and says it is about", () => {
    expect(formatArea(570150, "ko")).toBe("약 57만 ㎢");
    expect(formatArea(1575, "ko")).toBe("약 1,600 ㎢");
    expect(formatArea(12345, "ko")).toBe("약 12,000 ㎢");
    expect(formatArea(99999, "ko")).toBe("약 10만 ㎢");
    expect(formatArea(3456789, "ko")).toBe("약 350만 ㎢");
    expect(formatArea(570150, "en")).toBe("about 570,000 km²");
    expect(formatArea(1575, "en")).toBe("about 1,600 km²");
  });

  it("says a change once, with the unit at its end", () => {
    expect(formatAreaChange(570150, 230000, "ko")).toBe("약 57만 → 23만 ㎢");
    expect(formatAreaChange(64000, 23000, "ko")).toBe("약 64,000 → 23,000 ㎢");
    expect(formatAreaChange(570150, 230000, "en")).toBe("about 570,000 → 230,000 km²");
  });
});

describe("the world's record speaks of land in square kilometres", () => {
  const world = generateWorld({ ...DEFAULT_PARAMS, seed: 1 }).world;
  const history = simulateHistory(world, 1);

  it("measures a realm and the settled land in km², never in the map's cells", () => {
    for (const lang of ["ko", "en"] as const) {
      const doc = worldToGazetteer(world, history, lang);
      expect(doc, `${lang}: a count of cells`).not.toMatch(lang === "ko" ? /\d\s*칸/ : /\d\s*tiles?\b/);
      expect((doc.match(lang === "ko" ? /㎢/g : /km²/g) ?? []).length, `${lang}: no area in km²`).toBeGreaterThan(5);
    }
  });

  // A century's standing used to read "200년 현재 — ...", and the caption under the scrubber carries a line
  // forward until the next: at 250 the reader was told what stood "now" in 200 (44 of 612 steps, 12 worlds).
  it("tells a century's standing as of its year, without calling it the present", () => {
    const lines = buildChronicle(world, history, "ko");
    const centuries = lines.filter((l) => l.kind === "century");
    expect(centuries.length, "no century's standing to read").toBeGreaterThan(2);
    for (const l of centuries) expect(l.short ?? l.text, l.text).not.toMatch(/현재/);
  });
});
