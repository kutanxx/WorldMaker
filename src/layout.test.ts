import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const css = () => readFileSync("src/theme.css", "utf8");
const BLOCK_END = String.fromCharCode(10) + "}";   // where a top-level media block ends

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

// ㊾ took the plate's key off the drawing and stood it under it, and wrote down what that cost:
// the page scrolls. Measured live at 1440x900 it is 282px, and the key doing the scrolling is a
// 130px column standing in a 1151px band — 89% empty parchment — because the band is the whole
// page. Beside the drawing it costs the page nothing: 282px of scroll becomes 76px.
//
// ⚠ This is NOT the absolute placement ㊾ measured and rejected. That one floated the key in the
// frame's own margin, where a tall window has no margin and the key ends up over the drawing. This
// is a grid column that takes its own room, the same one the world map gives its town list — so the
// only thing it can cost is the drawing's WIDTH, and the arithmetic below says when that is zero.
describe("the plate's key stands beside the drawing where there is room", () => {
  const wideBlock = () => {
    const c = css();
    const i = c.indexOf("@media (min-width: 901px) and (min-aspect-ratio:");
    expect(i, "there is no window shape in which the plate keeps a side column").toBeGreaterThan(-1);
    return c.slice(i, c.indexOf(BLOCK_END, i));
  };

  it("gives the card a second column and puts the key in it", () => {
    const block = wideBlock();
    expect(block, "the plate's card is not a grid, so there is no column to stand in")
      .toMatch(/\.stage\.plate\s*\{[^}]*grid-template-columns:[^;]*\d+px/);
    expect(block, "the key is not placed in the second column")
      .toMatch(/\.stage\.plate\s*>\s*\.legend-fold\s*\{[^}]*grid-column:\s*2/);
    // the caption and the way back belong to the page, not to the drawing's column
    expect(block, "the fact strip is trapped in the drawing's column")
      .toMatch(/\.city-facts\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/);
  });

  // ★ The number in the media query is not a taste. The plate is capped by the room its chrome
  // leaves it — `(100vh - RESERVE) * 494/460` — and by the band it sits in, so a side column costs
  // the drawing NOTHING exactly while `band - (column + gap) >= that cap`. Anything else is width
  // taken off the drawing, which is what ㊾ refused. This reads all four numbers out of the
  // stylesheet, so changing the column's width, the gap, the plate's reserve or the ratio without
  // redoing the arithmetic fails here instead of silently shrinking the plan.
  it("takes that column only at window shapes where the drawing loses no width", () => {
    const c = css();
    const block = wideBlock();
    const ratio = (() => {
      const m = /min-aspect-ratio:\s*(\d+)\s*\/\s*(\d+)/.exec(block)!;
      return Number(m[1]) / Number(m[2]);
    })();
    const minW = Number(/min-width:\s*(\d+)px/.exec(block)![1]);
    const col = Number(/grid-template-columns:[^;]*?(\d+)px/.exec(block)![1]);
    const gap = Number(/\.stage\.plate\s*\{[^}]*gap:\s*(\d+)px/.exec(block)![1]);
    const reserve = Number(/\.stage svg\.city \{[^}]*\(100vh - (\d+)px\)/.exec(c)![1]);
    // What the page spends before the card's content box begins: 37px of margin on each side and
    // the card's own 22px of padding and border. Measured on the live page at three widths.
    const PAGE_CHROME = 96;
    for (let h = 600; h <= 1600; h += 25) {
      const w = Math.max(minW, ratio * h);        // the tightest window the query lets through
      // the page measure only binds on windows far taller than this query admits, so the window
      // itself is what decides the band here
      const band = w - PAGE_CHROME;
      const heightBound = ((h - reserve) * 494) / 460;
      expect(band - (col + gap), `at ${Math.round(w)}x${h} the column eats into the drawing`)
        .toBeGreaterThanOrEqual(heightBound);
    }
  });
});
