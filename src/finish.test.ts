import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// A finishing pass over the live site, read at 390x844 and 1440x900 on 2026-09-24. Each of these
// was measured on the page before it was changed; the numbers are in the notes beside each rule in
// theme.css.
const css = () => readFileSync("src/theme.css", "utf8");
const BLOCK_END = String.fromCharCode(10) + "}";
const blocksOf = (query: string) => {
  const c = css();
  const out: string[] = [];
  for (let i = c.indexOf(query); i > -1; i = c.indexOf(query, i + 1)) out.push(c.slice(i, c.indexOf(BLOCK_END, i)));
  return out.join(String.fromCharCode(10));
};
// the rule whose WHOLE selector is `sel` — `.timeline {` must not find `body.map-focus .timeline {`
const ruleIn = (block: string, sel: string) => {
  const m = new RegExp(`(?:^|\\n)[ \\t]*${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{`).exec(block);
  return m ? block.slice(m.index, block.indexOf("}", m.index)) : "";
};

// Measured at 390x844: the language toggle stood at 329..374 x 22..66, and the tagline's line ran
// 16..374 x 50..70 — the button sat on its last word. It is anchored to the TITLE's row now: it
// starts where the hero starts, and the title's row is made at least as tall as the button, so
// the tagline begins below both, whatever font the title arrives in.
describe("the front page's language toggle stands beside the title, not on the tagline", () => {
  const phone = () => blocksOf("@media (max-width: 640px)");
  it("starts the toggle at the top of the hero", () => {
    const heroTop = Number(/padding:\s*(\d+)px/.exec(ruleIn(css(), ".landing-hero"))?.[1]);
    const top = Number(/top:\s*(\d+)px/.exec(ruleIn(phone(), ".landing-lang"))?.[1]);
    expect(Number.isFinite(top), "no narrow-window position for the toggle").toBe(true);
    expect(top, "the toggle does not start with the title's row").toBe(heroTop);
  });
  // ⚠ Same specificity, so the LATER rule wins: the first cut put this in the phone block near the
  // top of the file, the base `.landing-lang { top: 22px }` came after it, and the button measured
  // at 22 on a phone with this test green.
  it("says it after the rule it overrides", () => {
    const c = css();
    const base = c.search(/\n\.landing-lang\s*\{/);
    const narrow = c.search(/\n[ \t]+\.landing-lang\s*\{[^}]*top:\s*8px/);
    expect(base, "no base rule for the toggle").toBeGreaterThan(-1);
    expect(narrow, "the phone's position comes before the rule it overrides").toBeGreaterThan(base);
  });
  it("makes the title's row as tall as the toggle beside it", () => {
    const rule = ruleIn(phone(), ".landing-hero .app-title");
    expect(rule, "the title's row can be shorter than the button standing in it")
      .toContain("min-height: var(--control-h)");
    expect(rule, "a declared height that is not border-box is a different height").toContain("box-sizing: border-box");
    expect(rule, "the title is not centred in its row").toMatch(/align-items:\s*center/);
  });
  it("gives the line under the daily button the gutter every other block has", () => {
    // measured 0..390 on a phone: the one block on the page with no gutter
    expect(ruleIn(css(), ".landing-daily")).toMatch(/padding:\s*0 16px/);
  });
});

// Measured at 390x844: the compass was 9x12px with a 3px "N", and at 1440x900 the focus chip
// (994..1052 x 159..186) stood on top of it (1029..1055 x 149..184). The compass is decoration
// on a map whose north is always up; on a phone it is a smudge, and on a desktop it was hidden.
describe("the compass is either legible or absent", () => {
  it("is not drawn on a phone-sized map", () => {
    expect(phoneRule(), "a 9px compass is still drawn on a phone").toMatch(/display:\s*none/);
  });
  const phoneRule = () => ruleIn(blocksOf("@media (max-width: 640px)"), "svg.world .compass");
});

// Measured at 390x844: the bar's first row started at x=29 and its second at x=41, because the
// 12px that separates the zones on ONE row is paid at the start of every wrapped row too. Opened,
// the bar was four rows with three left edges, and the language toggle stood alone on the fourth.
describe("a wrapped toolbar keeps one left edge", () => {
  it("drops the zone gaps where the bar wraps into rows", () => {
    const block = blocksOf("@media (max-width: 900px)");
    for (const sel of [".seed-group", ".view-toggle", ".export-group"]) {
      expect(block, `${sel} still starts its row 12px in`)
        .toMatch(new RegExp(`\\.controls > \\${sel}[^{]*\\{[^}]*margin-left:\\s*0`));
    }
  });
});

describe("a finger gets the same 44 everywhere, again", () => {
  const coarse = () => blocksOf("@media (pointer: coarse)");
  // measured 36x44 — the one button in the scrubber row that is not square
  it("gives the play button the width a finger is owed", () => {
    expect(ruleIn(css(), ".timeline-play")).toContain("min-width: var(--control-h)");
  });
  // measured 36px tall against 44 for every other thing a finger presses; the list is folded by
  // default, so the length this costs is only paid by a reader who asked for the list
  it("gives the town list's rows the shared height on a touch screen", () => {
    const rule = ruleIn(coarse(), ".city-list-item");
    expect(rule).toContain("min-height: var(--control-h)");
    expect(rule).toContain("box-sizing: border-box");
    expect(rule, "a taller row that keeps its text at the top").toMatch(/align-items:\s*center/);
  });
  // measured 46px: the global `button, input` rule's padding and border on top of a content-box
  // height — the same shape the scrubber had
  it("gives the world settings' sliders the scrubber's box", () => {
    const rule = ruleIn(css(), ".advanced-row input[type=range]");
    expect(rule).toMatch(/border:\s*0/);
    expect(rule).toMatch(/padding:\s*0/);
    expect(rule).toContain("min-height: var(--control-h)");
    expect(rule).toContain("box-sizing: border-box");
    expect(coarse(), "the settings sliders name a height of their own again").not.toMatch(/input\[type=range\]\s*\{[^}]*min-height:\s*\d+px/);
  });
});

// The fold heads carried a 13px triangle at the far right, and the world settings a browser
// disclosure triangle at the far LEFT — two kinds of disclosure on one page.
describe("one page, one kind of disclosure", () => {
  it("draws the settings head's marker the way the fold heads draw theirs", () => {
    const c = css();
    expect(ruleIn(c, ".advanced > summary"), "the settings head keeps the browser's marker").toMatch(/list-style:\s*none/);
    expect(c, "the settings head has no marker of its own").toMatch(/\.advanced > summary::after\s*\{[^}]*content:\s*"\\25be"/);
    expect(c, "WebKit's own marker is still drawn").toMatch(/\.advanced > summary::-webkit-details-marker\s*\{[^}]*display:\s*none/);
  });
  it("draws the marker big enough to see", () => {
    const size = Number(/font-size:\s*(\d+)px/.exec(ruleIn(css(), ".fold-mark"))?.[1]);
    expect(size, "the fold mark takes the head's 13px").toBeGreaterThanOrEqual(16);
  });
});

// Measured: 36px of parchment between the map and the scrubber at 390x844 (the stacked grid's 12,
// the strip's 12 and the scrubber's own 12) and 24 at 1440x900 (the last two), against 6 between
// the scrubber and its caption. One gap, whichever parent the strip is standing in.
describe("the scrubber sits one gap under the map", () => {
  it("does not stack a margin on the strip and another on the scrubber inside it", () => {
    expect(ruleIn(css(), ".timeline-strip")).toMatch(/margin-top:\s*12px/);
    expect(ruleIn(css(), ".timeline"), "the scrubber adds its own gap on top of the strip's").not.toMatch(/margin-top:\s*[1-9]/);
  });
  it("lets the grid's gap stand for the strip's where the strip is moved into the grid", () => {
    expect(ruleIn(blocksOf("@media (max-width: 900px)"), ".map-with-list > .timeline-strip"))
      .toMatch(/margin-top:\s*0/);
  });
});

// The map's height is "the window, less the chrome around it", and the chrome was counted before
// the chronicle became a caption under the scrubber (㊿) — so that caption was never paid for.
// Measured at 1440x900, 1366x768 and 1920x945 alike: the caption ended 16-17px under the window's
// bottom edge and the card 27px under it, so a reader scrubbing the years had to scroll to read
// what happened in them. Measured chrome: 145px above the map (title, bar, card's top edge) and
// 132px below it (gap, scrubber, caption, card's bottom edge) — 277, and 12 of air under the card.
describe("the whole card fits the window it was sized for", () => {
  it("budgets the chrome that is actually on the page, caption included", () => {
    const budget = Number(/--page:\s*max\(\d+px,\s*calc\(\(100vh - (\d+)px\)/.exec(css())?.[1]);
    expect(Number.isFinite(budget), "the page measure no longer reads the window's height").toBe(true);
    expect(budget, "the caption under the scrubber is left below the fold again").toBeGreaterThanOrEqual(277 + 12);
  });
});
