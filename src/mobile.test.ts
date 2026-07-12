import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

// Phones without this meta lay the page out at ~980px and scale it down — every
// control shrinks to ~38% (measured: a 32px advance button ≈ 12pt on a 375pt phone).
describe("mobile viewport meta", () => {
  for (const f of ["index.html", "play.html", "map.html"]) {
    it(`${f} declares a device-width viewport`, () => {
      expect(read(f)).toMatch(/<meta name="viewport" content="width=device-width, initial-scale=1"/);
    });
  }
});
