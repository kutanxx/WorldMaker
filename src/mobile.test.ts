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

  // The chip moved to the opposite corner when the key opened. Where the key is on the map that is
  // deliberate (it covered the key's bottom row). Where the key is NOT on the map it is the bug:
  // the control leaves the place it was pressed.
  it("moves the key's chip only where the key is actually on the map", () => {
    const i = css().indexOf(".map-frame:not(.legend-off) .legend-toggle");
    expect(i, "the chip's corner-jump is gone entirely").toBeGreaterThan(-1);
    const before = css().slice(0, i);
    const query = before.slice(before.lastIndexOf("@media"));
    expect(query.slice(0, query.indexOf("{")), "the jump is not held to wide windows").toContain("min-width: 901px");
  });

  it("hands the key's control to the fold's head on a narrow window", () => {
    const i = css().indexOf("@media (max-width: 900px)");
    const block = css().slice(i, css().indexOf("\n}", i));
    expect(block).toContain(".legend-fold");
    expect(block).toContain(".legend-toggle { display: none");
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
});

// The plate's width cap is arithmetic on the plate's own geometry, and the geometry lives in
// TypeScript while the cap lives in CSS. Nothing but this test connects them, and a strip resized
// in one place without the other lets the plan run past the fold (or wastes the room).
describe("the plate's cap agrees with the plate's geometry", () => {
  const num = (src: string, name: string) => {
    const m = new RegExp(`export const ${name} = (\\d+)`).exec(src);
    expect(m, `${name} is gone from svgCityRenderer.ts`).not.toBeNull();
    return Number(m![1]);
  };
  it("caps a narrow plate at the width it actually has once the key has left it", () => {
    const src = read("src/ui/svgCityRenderer.ts");
    const bounds = 460; // layout.bounds.w, one constant for every town (engine/city.ts)
    const narrowPlate = bounds + num(src, "COMPASS_STRIP");
    const widePlate = bounds + num(src, "KEY_STRIP");
    const css = read("src/theme.css");
    const i = css.indexOf("@media (max-width: 900px)");
    const block = css.slice(i, css.indexOf("\n}", i));
    expect(block, `a narrow plate is ${narrowPlate} units wide`).toContain(`${narrowPlate} / ${bounds}`);
    // and the wide cap is still the whole plate, strip and all
    expect(css.slice(0, i), `a wide plate is ${widePlate} units wide`).toContain(`${widePlate} / ${bounds}`);
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
