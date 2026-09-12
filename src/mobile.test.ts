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

// The first phone this page was ever opened on found two things that look like a key and no way to
// fold either — plus 641px of town list and chronicle under a 225px map. These hold the three
// stylesheet rules that answer it.
describe("a narrow window folds the panels the map cannot carry", () => {
  const css = () => read("src/theme.css");

  // The key is drawn in MAP units, so on screen it is whatever the map is scaled to: x0.993 on a
  // desktop, x0.321 on a 375px phone — 6px type. Below 900px it comes off the map into its own
  // sheet at one unit to one pixel, and that sheet must beat `.stage svg { width: 100% }`, which
  // would stretch a 112-unit key across the page.
  it("gives the key's sheet its own size, against the rule that stretches every drawing", () => {
    const rule = css().slice(css().indexOf(".stage .legend-sheet"));
    expect(rule.slice(0, rule.indexOf("}"))).toContain("width: auto");
  });
  // ⚠ This test has been turned twice, and each turn was the same lesson arriving later. It first
  // REQUIRED the chip to jump to the far corner when the key opened (held to wide windows, where
  // the key was on the map). Then it required that nothing move the chip at all. Now there is no
  // chip: a key on the map covers the map, and measured over 12 seeds it stood on a town in 11 of
  // 336 towns and in SIX of the twelve worlds. The key stands in the column beside the map, at
  // every width, and its fold's head is the only control.
  it("keeps the key off the map, at every width", () => {
    expect(css(), "the map carries a chip again").not.toContain(".legend-toggle");
    expect(css(), "the key is floated back onto the drawing").not.toContain(".map-frame .legend-sheet");
    expect(css(), "the key has no place in the column beside the map")
      .toContain(".map-with-list > .legend-fold");
  });

  it("stacks the key with the other sections on a narrow window", () => {
    const i = css().indexOf("@media (max-width: 900px)");
    const block = css().slice(i, css().indexOf("\n}", i));
    expect(block).toContain(".legend-fold");
    // the column placements are for the wide layout only; stacked, they must let go
    expect(block).toMatch(/grid-column:\s*auto/);
    // a scrolling box inside a scrolling page is the worst thing a finger can meet
    expect(block).toMatch(/\.city-list\s*\{[^}]*max-height:\s*none/);
  });


  it("gives the three heads a finger-sized target", () => {
    const c = css();
    const blocks = c.split("@media (pointer: coarse)").slice(1);
    const head = blocks.find((b) => b.slice(0, b.indexOf("\n}")).includes(".fold-head"));
    expect(head, ".fold-head has no coarse-pointer rule").toBeTruthy();
    expect(head!.slice(0, head!.indexOf("\n}"))).toContain("min-height: 44px");
  });

  // ⚠ The finger's target used to be a flat `r: 20px` here, and a CSS `r` beats the attribute the
  // renderer writes — so on a phone every target went back to 20 units and swallowed its
  // neighbours: measured over 12 seeds, 43 of 336 town centres (12.8%) land inside another town's
  // target at a flat 20, in 9 of the 12 worlds. The rule may raise the CEILING; the per-city clamp
  // has to survive it.
  it("gives a finger a bigger target without letting it swallow the next town", () => {
    const block = css().split("@media (pointer: coarse)").slice(1)
      .map((b) => b.slice(0, b.indexOf("\n}")))
      .find((b) => b.includes(".marker-hit"));
    expect(block, ".marker-hit has no coarse-pointer rule at all").toBeTruthy();
    const rules = block!.replace(/\/\*[\s\S]*?\*\//g, "");   // the comment quotes the old rule
    expect(rules, "a flat radius is back, and it ignores the clamp").not.toMatch(/r:\s*\d+px/);
    expect(block, "the rule does not read the radius the renderer worked out").toContain("var(--hit-coarse");
  });

  // A page whose only sign that a speck is pressable was a keyboard focus ring. The reader's report
  // was "몇몇 도시는 클릭이 안돼 … 클릭 자체 표시가 안뜨거나" — one half was a target stealing the
  // click, the other half was that nothing answered the mouse at all.
  it("answers a mouse on a city's mark, not only a keyboard", () => {
    const c = css();
    expect(c, "a mark says nothing when the pointer is over it").toMatch(/\.marker-hit:hover\s*\{/);
    expect(c, "a mark says nothing when it is pressed").toMatch(/\.marker-hit:active\s*\{/);
    expect(c, "the name beside the mark opens the city too and says nothing").toMatch(/\.city-label:hover\s*\{/);
    // ...and the hover has to survive the pointer actually reaching the dot. The marks are drawn ON
    // TOP of the target, so while they took pointer events the halo lit up around the speck and went
    // out the moment the pointer was on it. One interactive element per city; the marks are ink.
    expect(c, "the marks take the pointer, so the hover dies where the reader aims")
      .toMatch(/\.marker-town,\s*\.marker-capital\s*\{[^}]*pointer-events:\s*none/);
  });
});

// The plate's width cap is arithmetic on the plate's own geometry, and the geometry lives in
// TypeScript while the cap lives in CSS. Nothing but this test connects them, and a strip resized
// in one place without the other lets the plan run past the fold (or wastes the room).
describe("the plate's cap agrees with the plate's geometry", () => {
  const num = (src: string, name: string) => {
    const m = new RegExp("export const " + name + " = ([0-9]+)").exec(src);
    expect(m, `${name} is gone from svgCityRenderer.ts`).not.toBeNull();
    return Number(m![1]);
  };
  // ⚠ There used to be two caps, because there used to be two plates: a wide one with the key in a
  // 108-unit strip beside the town, and a narrow one whose key had left. The key now leaves at
  // every width — it is furniture, and furniture inside an SVG is carried off by the zoom — so
  // there is one plate, 34 units of compass beside the town, and the two caps must agree on it.
  it("caps the plate at the width it actually has, the key having left it", () => {
    const src = read("src/ui/svgCityRenderer.ts");
    const bounds = 460; // layout.bounds.w, one constant for every town (engine/city.ts)
    const plate = bounds + num(src, "COMPASS_STRIP");
    const withKey = bounds + num(src, "KEY_STRIP");
    const css = read("src/theme.css");
    const i = css.indexOf("@media (max-width: 900px)");
    expect(css.slice(i, css.indexOf("\n}", i)), `the plate is ${plate} units wide`).toContain(`${plate} / ${bounds}`);
    expect(css.slice(0, i), `the plate is ${plate} units wide here too`).toContain(`${plate} / ${bounds}`);
    expect(css, "a cap still measures the plate with the key's strip in it").not.toContain(`${withKey} / ${bounds}`);
  });
});

// Three sections in a stack have to read as one stack. The town list arrived from being a PANEL
// beside the map — parchment box, 10px inset — and kept it when it stacked, so on the live page its
// head started at x=37 against the other two at x=27 and ran 305px against their 321px.
describe("the sections under a narrow map line up", () => {
  it("strips the town list's panel where it is no longer a panel", () => {
    const css = read("src/theme.css");
    const i = css.indexOf("@media (max-width: 900px)");
    const block = css.slice(i, css.indexOf("\n}", i));
    const rule = block.slice(block.indexOf(".city-list {"), block.indexOf("}", block.indexOf(".city-list {")));
    expect(rule, "the list keeps an inset the other two sections do not have").toMatch(/padding:\s*0/);
    expect(rule, "the list keeps a box the other two sections do not have").toMatch(/background:\s*none/);
  });
});

// The toolbar was the biggest thing on the phone's first screen: title + controls 236px of 812,
// over a map 225px tall, in four rows — one of them holding the language toggle by itself.
describe("a narrow window folds the toolbar too", () => {
  const narrowBlock = () => {
    const css = read("src/theme.css");
    const i = css.indexOf("@media (max-width: 900px)");
    return css.slice(i, css.indexOf("\n}", i));
  };
  it("shows the one control that stands for the rest, and only there", () => {
    const css = read("src/theme.css");
    const own = css.slice(css.indexOf(".more-toggle {"), css.indexOf("}", css.indexOf(".more-toggle {")));
    expect(own, "the control is visible on wide windows too").toMatch(/display:\s*none/);
    expect(narrowBlock()).toContain(".more-toggle { display: inline-flex");
  });
  it("folds what a phone can do least with, until it is asked", () => {
    expect(narrowBlock()).toContain(".controls:not(.more-open) .secondary { display: none");
  });
  it("drops the world map's own controls on a city plate", () => {
    expect(narrowBlock()).toContain(".controls.plate .world-only { display: none");
  });
});

// With pinch working, `+` and `−` are a mouse's way of doing what two fingers already do — and the
// three of them together covered 19% of a 321px-wide map. The reset stays: a pinch can leave you
// somewhere you cannot pinch your way back from.
describe("a narrow map keeps the zoom out of the drawing", () => {
  it("hides the buttons two fingers replace, and only those", () => {
    const css = read("src/theme.css");
    const i = css.indexOf("@media (max-width: 900px)");
    const block = css.slice(i, css.indexOf("\n}", i));
    expect(block).toContain(".map-zoom-controls .zoom-in, .map-zoom-controls .zoom-out { display: none");
    expect(block, "the reset went with them").not.toContain(".zoom-reset { display: none");
  });
});

// Nothing on a developer machine can prove a phone delivers two pointers through `touch-action:
// pan-y`, so the stylesheet does not assume it: zoomPan marks the controls when the browser takes
// a two-finger gesture away, and the buttons two fingers replaced come back.
describe("hiding the zoom buttons is not a dead end", () => {
  it("brings them back when pinch turns out to be unavailable", () => {
    const css = read("src/theme.css");
    const i = css.indexOf("@media (max-width: 900px)");
    const block = css.slice(i, css.indexOf("\n}", i));
    expect(block).toContain(".map-zoom-controls.pinch-unavailable .zoom-in");
    expect(block).toContain(".map-zoom-controls.pinch-unavailable .zoom-out");
    // and the class has to be one zoomPan actually sets
    expect(read("src/ui/zoomPan.ts")).toContain('classList.add("pinch-unavailable")');
  });
});

// The plate's fact strip read as one grey ribbon. Measured live: the gap that JOINS a label to its
// answer is 7px and the gap that SEPARATES two facts is 22px — at 13px type that is 1.7 characters
// of difference, and on a phone the strip wraps with a ragged second column (27 / 176 / 219), so it
// reads as a sentence rather than a table.
describe("the plate's facts read as facts", () => {
  const css = () => read("src/theme.css");
  it("lays them out as an aligned two-column list on a narrow window", () => {
    const i = css().indexOf("@media (max-width: 900px)");
    const block = css().slice(i, css().indexOf("\n}", i));
    expect(block).toMatch(/\.city-facts\s*\{[^}]*display:\s*grid/);
    // `display: contents` is what puts each fact's label and answer into the SAME grid, which is
    // the whole point: without it the columns cannot line up across rows.
    expect(block).toMatch(/\.city-fact\s*\{[^}]*display:\s*contents/);
  });

  // The ratio is the fix on a wide window: the strip is one row there, and what tells two facts
  // apart is the difference between 7px and 22px.
  it("separates two facts by much more than it joins a label to its answer", () => {
    const c = css();
    const strip = c.slice(c.indexOf(".city-facts {"), c.indexOf("}", c.indexOf(".city-facts {")));
    const between = Number(/gap:\s*\d+px\s+(\d+)px/.exec(strip)?.[1]);
    const pair = c.slice(c.indexOf(".city-fact {"), c.indexOf("}", c.indexOf(".city-fact {")));
    const within = Number(/gap:\s*(\d+)px/.exec(pair)?.[1]);
    expect(Number.isFinite(between) && Number.isFinite(within), "the two gaps are not both declared").toBe(true);
    expect(between / within, `${between}px between facts against ${within}px within one`).toBeGreaterThanOrEqual(5);
  });
});

// Measured on a phone: every block on the landing started at x=16 except the name row, which ran
// 0..375 — the one element on the page with no gutter.
describe("the landing's rows share one left edge", () => {
  it("gives the name row the gutter every other block has", () => {
    const css = read("src/theme.css");
    const rule = css.slice(css.indexOf(".landing-name {"), css.indexOf("}", css.indexOf(".landing-name {")));
    expect(rule, "the name row is still full-bleed on a narrow screen").toMatch(/padding:\s*0 16px/);
  });
});
