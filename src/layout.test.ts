import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const css = () => readFileSync("src/theme.css", "utf8");

// Measured at 1440x900 before this: the toolbar ran 53→1373, the map block 137→1288, the scrubber
// 64→1362 and the world settings 213→1213 — four left edges and four right edges down one page.
// Only the map's width is actually decided by anything (the vertical room left over, x10/7); the
// rest had each picked a number. The page keeps ONE measure now, and the blocks take it.
describe("the page has one measure", () => {
  it("declares it once and spends it on the bar, the card and the settings", () => {
    const c = css();
    expect(c, "no page measure to share").toMatch(/--page:\s*max\(/);
    // the map block no longer carries its own cap — the card it sits in is the measure
    const block = c.slice(c.search(/^\.map-with-list \{/m));
    expect(block.slice(0, block.indexOf("}")), "the map block caps itself again, beside the card's cap")
      .not.toMatch(/max-width/);
    for (const sel of ["#app > .controls, #app > .stage", "#app > .advanced"]) {
      const i = c.indexOf(sel);
      expect(i, `${sel} has no rule`).toBeGreaterThan(-1);
      expect(c.slice(i, c.indexOf("}", i)), `${sel} does not use the page measure`).toContain("var(--page)");
    }
  });

  // The plate's fact strip was the last element still measured against the 1040px page this file
  // replaced — the very number the stylesheet's own comment calls dead. At 1440x900 it ran
  // 209→1217 inside a card running 137→1288: a third vertical edge on a page that keeps two. And
  // the dead cap costs a line — measured live on one town, the strip is 48px tall at 1008 and 23px
  // at the card's own 1151, so a page-wide strip is also a shorter one.
  it("measures the plate's fact strip by the card it sits in", () => {
    const c = css();
    const i = c.indexOf(".city-facts {");
    expect(i, "the fact strip has no rule").toBeGreaterThan(-1);
    expect(c.slice(i, c.indexOf("}", i)), "the strip still carries a width the page never gave it")
      .not.toMatch(/max-width:\s*\d/);
  });

  // The plate is centred in the card, and its key was not: measured at 1440x900, the drawing ran
  // 353→1072 inside a band running 137→1288, and the key — a 130px column — stood at the far left
  // of that band, 216px from the edge of the thing it explains. Under the WORLD map the key sits in
  // a 210px side column about its own width, so this is the plate's case alone.
  it("stands the plate's key under the drawing it belongs to", () => {
    const c = css();
    const i = c.indexOf(".stage.plate .legend-sheet");
    expect(i, "the plate's key is placed by whatever the world map's key does").toBeGreaterThan(-1);
    expect(c.slice(i, c.indexOf("}", i)), "the key still hugs the left edge of a band it does not fill")
      .toMatch(/margin-inline:\s*auto/);
  });

  // `min-height: 100%` measures the CONTENT box: the list hung 16px — its own 8px padding, twice —
  // below the map it is meant to end level with.
  it("keeps the town list inside the row it is given", () => {
    const c = css();
    const i = c.search(/^\.city-list \{/m);
    expect(c.slice(i, c.indexOf("}", i)), "the list measures its content and adds its padding on top")
      .toContain("box-sizing: border-box");
  });

  // The column beside the map is two panels and they have to be the same panel: the key section was
  // bare while the list had parchment and a radius but no edge (`.fold { border: 0 }` comes later in
  // the file and was winning), against a page whose every other box is parchment in a 1px edge.
  it("draws the key and the town list as the same kind of panel", () => {
    const c = css();
    const i = c.indexOf(".map-side > .legend-fold, .map-side > .city-list");
    expect(i, "the column's two panels have no shared rule").toBeGreaterThan(-1);
    const rule = c.slice(i, c.indexOf("}", i));
    expect(rule).toContain("#f6efdc");
    expect(rule).toContain("1px solid #cbb784");
    // ...and only where they ARE panels: stacked under a narrow map they are one flat stack
    const before = c.slice(0, i);
    expect(before.slice(before.lastIndexOf("@media")), "the panel rule is not held to wide windows")
      .toContain("min-width: 901px");
  });

  // The one box on this page that scrolls wore 15px of the system's own grey chrome down the inside
  // of a parchment panel.
  it("draws the town list's scrollbar in the page's own ink", () => {
    const c = css();
    expect(c).toMatch(/\.city-list\s*\{[^}]*scrollbar-color:\s*#cbb784/);
    expect(c).toMatch(/\.city-list::-webkit-scrollbar-thumb\s*\{[^}]*#cbb784/);
  });

  // A long realm name ran 13-14px out of its own row: `nowrap` with nothing allowed to shrink.
  it("keeps a long realm name inside its row", () => {
    const c = css();
    const i = c.indexOf(".city-list-realm {");
    const rule = c.slice(i, c.indexOf("}", i));
    expect(rule).toContain("text-overflow: ellipsis");
    expect(rule, "a flex item cannot shrink below its content without this").toContain("min-width: 0");
  });
});
