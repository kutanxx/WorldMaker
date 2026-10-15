import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// What a first visit meets in the page's chrome, after the design review of 2026-10-15 (items 13, 15, 19 and
// the small ones): read off the stylesheet and the two HTML shells, the way layout.test reads the rules.
const css = () => readFileSync("src/theme.css", "utf8");
const html = (f: string) => readFileSync(f, "utf8");
const rule = (sel: RegExp) => { const m = css().match(sel); return m ? m[0] : ""; };

describe("the page's chrome, for a first visit", () => {
  // the browser's own ring was orange in one browser and black in another, and the marker alone had the page's
  it("gives every control the same focus ring, in the page's own red", () => {
    expect(css()).toMatch(/button:focus-visible,\s*a:focus-visible,\s*input:focus-visible,\s*summary:focus-visible\s*\{[^}]*outline:\s*2px solid #7a2f2f/);
  });

  // measured: the fold head's count #8a7a5c read 3.65 against its panel, the golden-age caption #9a6a1a 4.11 — under AA
  it("lifts the two colours that measured under AA", () => {
    expect(rule(/\.fold-count\s*\{[^}]*\}/), "the count is still the colour that measured 3.65").not.toMatch(/#8a7a5c/);
    expect(rule(/\.chronicle-caption\.evt-goldenage\s*\{[^}]*\}/), "the golden age still measures 4.11").not.toMatch(/#9a6a1a/);
  });

  // a bordered, centred box under the scrubber read as an input field; a caption stands under a rule
  it("sets the chronicle's caption as a caption, not a box", () => {
    const r = rule(/\n\.chronicle-caption\s*\{[^}]*\}/);
    expect(r).not.toMatch(/border:\s*1px solid/);
    expect(r).toMatch(/border-top:/);
  });

  it("writes the timeline's centuries at a readable size", () => {
    expect(rule(/\.timeline-tick\s*\{[^}]*\}/)).toMatch(/font-size:\s*11px/);
  });

  // the export menu drops from the bar onto the map's top-right corner, where the chips stand (item 19)
  it("hides the map's chips while the export menu stands over their corner", () => {
    expect(rule(/\.export-choosing[^{]*\{[^}]*\}/)).toMatch(/visibility:\s*hidden/);
  });

  it("stands still for a reader who asked for less motion", () => {
    expect(css()).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[^@]*transition:\s*none/);
  });

  // the English bar hid the seed's word from the screen (its width); it carries a sign now (app.ts, i18n)
  it("no longer hides the seed's word from an English reader", () => {
    expect(css()).not.toMatch(/html:lang\(en\) \.seed-label > span/);
  });

  it("gives both pages a main landmark and a colour for the browser's own chrome", () => {
    for (const f of ["map.html", "index.html"]) {
      expect(html(f), f).toMatch(/<main id="(app|landing)">/);
      expect(html(f), f).toMatch(/<meta name="theme-color" content="#e8dcc0"/);
    }
  });
});
