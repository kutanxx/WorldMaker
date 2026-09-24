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
    // (measured at run time now — see the next describe — and this is its fallback)
    const budget = Number(/--page:\s*max\(\d+px,\s*calc\(\(100vh - (?:var\(--chrome,\s*)?(\d+)px\)/.exec(css())?.[1]);
    expect(Number.isFinite(budget), "the page measure no longer reads the window's height").toBe(true);
    expect(budget, "the caption under the scrubber is left below the fold again").toBeGreaterThanOrEqual(277 + 12);
  });
});

// ★ The reset on a phone stands alone (two fingers replaced + and −), and it was a button inside a
// second box — a mount 60x42 around a 48x30 button — beside the focus chip's single pill: two kits
// on one map. Alone, it IS a chip, the focus chip's exact look; and it appears only when there is
// a zoom to undo, so at rest the map carries one control where it carried two (5.2% -> 2.0%).
describe("the reset is the focus chip's twin, and only while zoomed", () => {
  const narrow = () => blocksOf("@media (max-width: 900px)");
  const chip = () => ruleIn(narrow(), ".map-zoom-controls:not(.pinch-unavailable) .zoom-reset");
  const prop = (rule: string, p: string) => new RegExp(`(?:^|[;{\s])${p}:\s*([^;]+);`).exec(rule)?.[1].trim();

  it("hides the whole control at rest, where the reset alone would stand", () => {
    expect(ruleIn(narrow(), ".map-zoom-controls.at-rest:not(.pinch-unavailable)")).toMatch(/display:\s*none/);
  });
  it("drops the mount where there is one button to mount", () => {
    const mount = ruleIn(narrow(), ".map-zoom-controls:not(.pinch-unavailable)");
    expect(mount).toMatch(/background:\s*none/);
    expect(mount).toMatch(/border:\s*0/);
    expect(mount).toMatch(/padding:\s*0/);
  });
  it("wears the focus chip's own look", () => {
    const focus = ruleIn(css(), ".focus-toggle");
    for (const p of ["padding", "font-size", "letter-spacing", "line-height", "background", "border", "border-radius", "box-shadow"]) {
      expect(prop(chip(), p), `the reset's ${p} is not the chip's`).toBe(prop(focus, p));
    }
    // the stack's finger-sized box must not reach the chip, or its ink is 44 tall on the map
    expect(chip()).toMatch(/min-height:\s*0/);
    expect(chip()).toMatch(/min-width:\s*0/);
  });
  it("writes the word only where the reset stands alone", () => {
    expect(ruleIn(css(), ".zoom-reset .zoom-reset-label"), "the stack's 30px square writes the word").toMatch(/display:\s*none/);
    expect(ruleIn(narrow(), ".map-zoom-controls:not(.pinch-unavailable) .zoom-reset .zoom-reset-label")).toMatch(/display:\s*inline/);
  });
  it("dims the reset in the stack while there is nothing to undo", () => {
    expect(ruleIn(css(), ".map-zoom-controls button:disabled")).toMatch(/opacity:\s*0?\.\d+/);
  });
  // The chip's 27px of ink reaches 44 for a finger AWAY from the map — the theft (51)/(52) hunted
  // is a target over a town. The world map's reset is in the bottom-right corner, so it reaches
  // down and right (into the gap under the frame); the plate's is in the top-left, so up and left.
  it("reaches for a finger away from the map, never into it", () => {
    const c = css();
    const world = /\.map-zoom-controls:not\(\.pinch-unavailable\) \.zoom-reset::after\s*\{[^}]*inset:\s*([^;]+);/.exec(c)?.[1];
    expect(world, "the reset has no reach").toBeDefined();
    const [t, r, b, l] = world!.split(/\s+/).map((v) => parseFloat(v));
    expect([t, l], "the reach goes up or left, over the map").toEqual([0, 0]);
    expect(b, "the reach does not make 44 below a 27px chip").toBeLessThanOrEqual(-17);
    expect(r).toBeLessThan(0);
    const plate = /\.stage\.plate \.map-zoom-controls:not\(\.pinch-unavailable\) \.zoom-reset::after\s*\{[^}]*inset:\s*([^;]+);/.exec(c)?.[1];
    expect(plate, "the plate's reset has no reach of its own").toBeDefined();
    // ⚠ ...but not past the plate's top edge: the way back ends exactly where the plate begins
    // (173 and 173, measured on a phone), so up is capped at the controls' own 14px inset and the
    // rest of the 17 is made up downward, over a drawing with nothing in it to press.
    const [pt, pr, pb, pl] = plate!.split(/\s+/).map((v) => parseFloat(v));
    expect(pt, "the plate's reach takes the bottom of the way back").toBeGreaterThanOrEqual(-14);
    expect(-(pt + pb), "the plate's reach does not make 44").toBeGreaterThanOrEqual(17);
    expect(pr, "the plate's reach goes right, off its corner").toBe(0);
    expect(pl).toBeLessThan(0);
  });
});

// Measured on a 390x844 phone: the key's first swatch stood at x=28 while its own heading, the town
// list's heading and every town name start at x=33 — the fold head's 6px padding, which the key
// never had. And its second column stood at x=144, lined up with nothing, with the right third of
// the panel empty. The key starts where its heading's words start.
describe("the key stands under its heading's words", () => {
  it("insets the key by the fold head's own padding", () => {
    const head = /padding:\s*\d+px\s+(\d+)px/.exec(ruleIn(css(), ".fold-head"))?.[1];
    const sheet = ruleIn(css(), ".stage .legend-sheet");
    expect(sheet, "the key has no inset").toContain(`margin: 0 ${head}px`);
    expect(sheet, "the inset lets the key run past its panel").toContain(`max-width: calc(100% - ${Number(head) * 2}px)`);
    const src = readFileSync("src/ui/legendSheet.ts", "utf8");
    expect(Number(/KEY_INSET\s*=\s*(\d+)/.exec(src)?.[1]), "the key's room is measured with another inset").toBe(Number(head));
  });
  it("puts the plate's key there too on a narrow window, where it no longer centres", () => {
    expect(ruleIn(blocksOf("@media (max-width: 900px)"), ".stage.plate .legend-sheet")).toMatch(/margin-inline:\s*6px/);
  });
});

// Measured on a 390x844 phone, scrubbing twelve worlds: the caption stood 37px (one line) on 276
// steps, 56 (two) on 329 and 77 (three) on 7 — its height changed on 168 of 600 steps, and the key
// and the town list under it jumped 19-40px each time. Shortened to headlines the lines fit two, so
// a narrow window keeps room for two and centres one in it.
describe("the caption does not bounce the page under it", () => {
  const narrow = () => blocksOf("@media (max-width: 900px)");
  it("keeps room for two lines on a narrow window", () => {
    const rule = ruleIn(narrow(), ".chronicle-caption");
    const lh = Number(/line-height:\s*([\d.]+)/.exec(ruleIn(css(), ".chronicle-caption"))?.[1]);
    const min = Number(/min-height:\s*([\d.]+)em/.exec(rule)?.[1]);
    expect(min, "the caption keeps no room of its own").toBeCloseTo(2 * lh, 5);
    expect(rule, "a one-line caption sits at the top of a two-line box").toMatch(/align-items:\s*center/);
  });
  it("still disappears when it has nothing to say", () => {
    expect(css(), "a flex caption ignores the hidden attribute").toMatch(/\.chronicle-caption\[hidden\]\s*\{[^}]*display:\s*none/);
  });
});

// ★ ...and the budget is MEASURED now, not declared. 290 was right at 1440x900 with a mouse and a
// one-row toolbar, and wrong everywhere else it was measured: a Korean toolbar wraps on a 1366x650
// laptop window and an English one at 1366x768 (the card 25px past the window, the chronicle's line
// cut), a tablet's 44px controls add 24px, and a tablet in landscape cut the city plan's bottom 60px.
// The page measures what it spends and hands it to the stylesheet; the numbers stay as the fallback.
describe("the page measures what it spends around the drawing", () => {
  it("sizes the world map by a measured budget, with the old one as its fallback", () => {
    const m = /--page:\s*max\(\d+px,\s*calc\(\(100vh - var\(--chrome,\s*(\d+)px\)\)/.exec(css());
    expect(m, "the page measure is a fixed number again").not.toBeNull();
    expect(Number(m![1]), "the fallback forgets the caption under the scrubber").toBeGreaterThanOrEqual(277 + 12);
  });
  it("sizes the city plan the same way, every place it is capped", () => {
    // the rules whose WHOLE selector is `.stage svg.city` — focus mode's own cap is 100vh less the
    // scrubber's strip, and it is not a budget
    const resting = css().match(/(?:^|\n)[ \t]*\.stage svg\.city \{[^}]*\}/g) ?? [];
    expect(resting.length, "no plate cap").toBeGreaterThan(0);
    for (const r of resting) expect(r, "a plate cap still reads a fixed number").toContain("var(--plate-chrome, 230px)");
  });
});

// ★ A tablet is a touch screen too: two fingers zoom it, as they do a phone. Measured at 1024x768
// with the touch rules on: +, − and ↺ stood on the map at 48x44 each (a 60x152 mount, 2.8% of the
// map), where a phone shows nothing at rest and the "전체 보기" chip once zoomed.
describe("a touch screen of any width zooms like a phone", () => {
  const blockWith = (needle: string) => {
    const c = css();
    const i = c.indexOf(needle);
    const at = c.lastIndexOf("@media", i);
    return c.slice(at, c.indexOf("{", at));
  };
  it("hides the buttons two fingers replace on any touch screen", () => {
    const q = blockWith(".map-zoom-controls .zoom-in, .map-zoom-controls .zoom-out { display: none");
    expect(q).toContain("max-width: 900px");
    expect(q, "a tablet still carries + and −").toContain("pointer: coarse");
  });
  it("puts the reset away at rest and makes it the chip on any touch screen", () => {
    for (const needle of [".map-zoom-controls.at-rest:not(.pinch-unavailable) { display: none",
                          ".map-zoom-controls:not(.pinch-unavailable) .zoom-reset {"]) {
      expect(blockWith(needle), needle).toContain("pointer: coarse");
    }
  });
  it("gives the chip its reach on any touch screen, not only a narrow one", () => {
    const q = blockWith(".map-zoom-controls:not(.pinch-unavailable) .zoom-reset::after");
    expect(q).toContain("pointer: coarse");
    expect(q, "the reach is still held to narrow windows").not.toContain("max-width");
  });
});

// ★ `100vh` is the LARGE viewport on a phone or tablet browser — its height with the address bar
// retracted — so on arrival, with the bar showing, a page sized by it runs that bar's height
// (~50-60px) past what can be seen: a tablet in landscape, a phone turned sideways. The page is
// sized by the SMALL viewport, the height with the bar showing (`svh`), where the browser has it; on
// a desktop the two are the same. ⚠ In an `@supports` block, not as a second declaration: three of
// these carry a `var()`, and a declaration with a `var()` is accepted at parse time — on a browser
// without `svh` it would fail at computed time and drop to the property's initial value, not back
// to the `vh` line above it.
describe("the page is sized by the window with the browser's own bars showing", () => {
  it("gives every height it sizes by a small-viewport twin, where the browser has one", () => {
    const c = css();
    const at = c.indexOf("@supports (height: 100svh)");
    expect(at, "no small-viewport sizing").toBeGreaterThan(-1);
    const sup = c.slice(at, c.indexOf(BLOCK_END, at));
    const sized = [...c.slice(0, at).matchAll(/calc\(\(?100vh - [^;]+;/g)].map((m) => m[0]);
    expect(sized.length, "nothing sized by the window's height").toBeGreaterThanOrEqual(4);
    for (const d of new Set(sized)) {
      expect(sup, `${d} has no svh twin`).toContain(d.replace("100vh", "100svh"));
    }
    expect(c.slice(at + 1), "the vh sizing comes after its svh twin and wins").not.toMatch(/calc\(\(?100vh - /);
  });
});

// ★ Every district answers to its name on hover — the renderer gives each ward a <title> — but the
// pointer lands on whatever is drawn OVER the ward: measured at 1440x900 over six plates, 2,200
// points inside districts named one 31.8% of the time, and 47% of them landed on a building (no
// name), the rest on streets and walls. Those are ink, not places: the pointer goes through them.
describe("a district answers to its name wherever the pointer rests on it", () => {
  it("lets the pointer through the ink drawn over a district", () => {
    const c = css();
    const i = c.indexOf("svg.city .building");
    expect(i, "the buildings still take the pointer").toBeGreaterThan(-1);
    const rule = c.slice(c.lastIndexOf("}", i) + 1, c.indexOf("}", i));
    expect(rule).toMatch(/pointer-events:\s*none/);
    for (const ink of [".building", ".road-main", ".road-minor", ".road-main-casing", ".road-minor-casing", ".tree", ".ward-label"]) {
      expect(rule, `${ink} still stands between the pointer and its district`).toContain(`svg.city ${ink}`);
    }
    // ...and what carries a name of its own keeps the pointer
    for (const named of [".ward", ".parish-church", ".castle-inner", ".well"]) {
      expect(rule, `${named} lost its own name`).not.toMatch(new RegExp(`svg\.city \${named}[,\s{]`));
    }
  });
});
