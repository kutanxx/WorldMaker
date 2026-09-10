import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

// Phones without this meta lay the page out at ~980px and scale it down — every
// control shrinks to ~38% (measured: a 32px advance button ≈ 12pt on a 375pt phone).
describe("mobile viewport meta", () => {
  for (const f of ["index.html", "map.html"]) {
    it(`${f} declares a device-width viewport`, () => {
      expect(read(f)).toMatch(/<meta name="viewport" content="width=device-width, initial-scale=1"/);
    });
  }
});

// The witness used to be `.neighbor-chip`, the worst touch target on the page at 19px — and that
// element went with the games. The test outlived it, holding a rule in the stylesheet for a thing
// nothing rendered any more. The map's city markers are the worst target now (2.3-radius dots,
// measured at 5px on the live page), so they are what the block has to cover.
describe("coarse-pointer ergonomics", () => {
  it("theme.css widens the map's own touch targets, not only its buttons", () => {
    const css = read("src/theme.css");
    expect(css).toContain("@media (pointer: coarse)");
    const coarse = css.slice(css.indexOf("@media (pointer: coarse)"));
    expect(coarse).toContain(".marker-hit");
  });
  // The toolbar folds to two rows in English below ~1035px, so a narrow-window block tightens its
  // controls' padding from 10px to 6px. That block must NOT reach a touch screen: 1024 is a tablet
  // width, and a finger needs the roomier target more than that device needs one row. On a touch
  // screen, folding is the right answer.
  it("does not compact the toolbar on touch screens, only on fine-pointer windows", () => {
    const css = read("src/theme.css");
    const i = css.indexOf("@media (max-width: 1060px)");
    expect(i, "the narrow-window toolbar block is gone").toBeGreaterThan(-1);
    const query = css.slice(i, css.indexOf("{", i));
    expect(query).toContain("pointer: fine");
    const block = css.slice(i, css.indexOf("}", css.indexOf("{", i) + 1));
    expect(block).toContain(".controls button");
  });

  it("carries no rules for pages this site no longer has", () => {
    const css = read("src/theme.css");
    for (const gone of [".play-shell", "#play ", "#province-app", ".goal-chip", ".challenge-chip", ".neighbor-chip", ".tip-strip"]) {
      expect(css, `${gone} belongs to a page that was deleted`).not.toContain(gone);
    }
  });
});

// The zoom controls float over the map's own bottom-right corner, where sea names and coastal towns
// sit, and the map moves under them — so no square of map can be reserved against them at every
// zoom. They get a mount instead, the way an atlas mounts its furniture, so a name behind one reads
// as being behind a panel rather than as a smudge.
describe("the map's furniture sits on something", () => {
  it("gives the zoom controls a backing, not bare buttons over the map", () => {
    const css = read("src/theme.css");
    const block = css.slice(css.indexOf(".map-zoom-controls {"), css.indexOf(".map-zoom-controls button"));
    expect(block).toMatch(/background:\s*rgba\(/);
    expect(block).toMatch(/border:/);
  });
});
