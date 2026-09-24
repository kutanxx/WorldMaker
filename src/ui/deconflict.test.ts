// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { deconflictLabels, clearMarks, clearCastleName } from "./deconflict";

const NS = "http://www.w3.org/2000/svg";
type Box = { x: number; y: number; width: number; height: number };
function mkLabel(svg: SVGSVGElement, cls: string, box: Box) {
  const t = document.createElementNS(NS, "text");
  t.setAttribute("class", cls);
  (t as unknown as { getBBox: () => Box }).getBBox = () => box; // jsdom lacks getBBox; stub per element
  svg.appendChild(t);
  return t as unknown as SVGGraphicsElement;
}

describe("deconflictLabels", () => {
  it("hides a lower-priority label overlapping a higher-priority one; keeps a non-overlapping one", () => {
    const svg = document.createElementNS(NS, "svg") as SVGSVGElement;
    const nation = mkLabel(svg, "nation-label", { x: 0, y: 0, width: 50, height: 10 });
    const townOverlap = mkLabel(svg, "city-label city-town", { x: 10, y: 2, width: 40, height: 10 });
    const townFar = mkLabel(svg, "city-label city-town", { x: 200, y: 200, width: 30, height: 10 });
    deconflictLabels(svg, 4);
    expect(nation.style.visibility).toBe("");
    expect(townOverlap.style.visibility).toBe("hidden");
    expect(townFar.style.visibility).toBe("");
  });

  it("never hides the player's own nation label (top tier); the other nation yields", () => {
    const svg = document.createElementNS(NS, "svg") as SVGSVGElement;
    const other = mkLabel(svg, "nation-label", { x: 0, y: 0, width: 50, height: 10 });
    const player = mkLabel(svg, "nation-label player", { x: 5, y: 1, width: 50, height: 10 });
    deconflictLabels(svg, 4);
    expect(player.style.visibility).toBe("");
    expect(other.style.visibility).toBe("hidden");
  });

  it("clamps labels spilling past the viewBox back inside the map; rotated rivers are left alone", () => {
    const svg = document.createElementNS(NS, "svg") as SVGSVGElement;
    svg.setAttribute("viewBox", "0 0 1000 700");
    // a west-edge player label: box spills 40 units past the left edge (the Karkvrakh case)
    const west = mkLabel(svg, "nation-label player", { x: -40, y: 300, width: 120, height: 18 });
    west.setAttribute("x", "20");
    // an east-edge town: right edge at 1010, 20 past the frame pad
    const east = mkLabel(svg, "city-label city-town", { x: 960, y: 100, width: 50, height: 8 });
    east.setAttribute("x", "985");
    // a top-edge region label: spills above
    const north = mkLabel(svg, "region-label", { x: 500, y: -6, width: 60, height: 12 });
    north.setAttribute("y", "4");
    // a river label is ROTATED: its local-space bbox can't be shifted via x/y — must not be touched
    const river = mkLabel(svg, "river-label", { x: -30, y: 100, width: 60, height: 8 });
    river.setAttribute("x", "5");
    deconflictLabels(svg, 4);
    expect(Number(west.getAttribute("x"))).toBe(70);  // +50: box.x -40 → 10 (pad)
    expect(Number(east.getAttribute("x"))).toBe(965); // -20: right 1010 → 990
    expect(Number(north.getAttribute("y"))).toBe(20); // +16: box.y -6 → 10
    expect(Number(river.getAttribute("x"))).toBe(5);  // untouched
    expect(west.style.visibility).toBe("");           // clamping must not hide it
  });

  it("without a viewBox the clamp is skipped (culling still runs)", () => {
    const svg = document.createElementNS(NS, "svg") as SVGSVGElement;
    const t = mkLabel(svg, "nation-label", { x: -40, y: 0, width: 120, height: 18 });
    t.setAttribute("x", "20");
    deconflictLabels(svg, 4);
    expect(Number(t.getAttribute("x"))).toBe(20);
  });

  it("lifts a nation's name clear of a capital instead of deleting the capital", () => {
    // A nation's name is placed at the centroid of its territory and its capital usually sits near
    // that centroid too, so the two collide — and the capital, being the lower tier, was what
    // disappeared. Measured on seed 7's political view, three of eight capitals were lost this way.
    // A political map wants both.
    const svg = document.createElementNS(NS, "svg") as SVGSVGElement;
    svg.setAttribute("viewBox", "0 0 1000 700");
    const nation = mkLabel(svg, "nation-label", { x: 300, y: 300, width: 80, height: 12 });
    nation.setAttribute("y", "310");
    const capital = mkLabel(svg, "city-label city-capital", { x: 320, y: 305, width: 60, height: 10 });
    deconflictLabels(svg, 4);
    expect(capital.style.visibility).toBe("");        // the capital survives
    expect(nation.style.visibility).toBe("");         // and so does the nation
    expect(Number(nation.getAttribute("y"))).toBeLessThan(310);   // by moving the nation up
  });

  it("leaves a nation's name alone when no capital is under it", () => {
    const svg = document.createElementNS(NS, "svg") as SVGSVGElement;
    svg.setAttribute("viewBox", "0 0 1000 700");
    const nation = mkLabel(svg, "nation-label", { x: 300, y: 300, width: 80, height: 12 });
    nation.setAttribute("y", "310");
    mkLabel(svg, "city-label city-capital", { x: 700, y: 100, width: 60, height: 10 });
    deconflictLabels(svg, 4);
    expect(Number(nation.getAttribute("y"))).toBe(310);
  });
});

describe("deconflictLabels air gap", () => {
  it("hides a label that merely misses a kept one — a stack needs air, not just no collision", () => {
    const svg = document.createElementNS(NS, "svg") as SVGSVGElement;
    // measured on seed 7: two region names 3 units apart with 29 units of horizontal overlap, both
    // kept, reading as one two-line stack.
    const upper = mkLabel(svg, "region-label", { x: 0, y: 0, width: 100, height: 14 });
    const stacked = mkLabel(svg, "region-label", { x: 10, y: 17, width: 90, height: 14 });
    deconflictLabels(svg, 4);
    expect(upper.style.visibility).toBe("");
    expect(stacked.style.visibility).toBe("hidden");
  });

  it("still keeps a label that clears the gap", () => {
    const svg = document.createElementNS(NS, "svg") as SVGSVGElement;
    const upper = mkLabel(svg, "region-label", { x: 0, y: 0, width: 100, height: 14 });
    const below = mkLabel(svg, "region-label", { x: 10, y: 40, width: 90, height: 14 });
    deconflictLabels(svg, 4);
    expect(upper.style.visibility).toBe("");
    expect(below.style.visibility).toBe("");
  });
});

describe("deconflictLabels and the world's title", () => {
  it("reserves the title's space, so a region name cannot sit under it", () => {
    const svg = document.createElementNS(NS, "svg") as SVGSVGElement;
    const title = mkLabel(svg, "world-name-text", { x: 400, y: 14, width: 200, height: 22 });
    const under = mkLabel(svg, "region-label", { x: 420, y: 38, width: 160, height: 14 });
    const elsewhere = mkLabel(svg, "region-label", { x: 100, y: 300, width: 160, height: 14 });
    deconflictLabels(svg, 4);
    expect(title.style.visibility).toBe("");      // a title is never the thing that yields
    expect(under.style.visibility).toBe("hidden");
    expect(elsewhere.style.visibility).toBe("");
  });
});

// The pass has to survive being run again: once the map re-runs it on every zoom step, a pass that
// nudges a label by a delta each time would walk it off the map.
describe("deconflictLabels run more than once", () => {
  // A stub that follows the element, the way a real getBBox does — with a fixed box, moving a label
  // and re-measuring it look the same, and the drift this test is here to catch is invisible.
  const mkMoving = (svg: SVGSVGElement, cls: string, x: number, y: number, w: number, h: number) => {
    const t = document.createElementNS(NS, "text");
    t.setAttribute("class", cls); t.setAttribute("x", String(x)); t.setAttribute("y", String(y));
    (t as unknown as { getBBox: () => Box }).getBBox = () =>
      ({ x: Number(t.getAttribute("x")), y: Number(t.getAttribute("y")) - h, width: w, height: h });
    svg.appendChild(t);
    return t as unknown as SVGGraphicsElement;
  };

  it("puts a lifted nation label in the same place the second time", () => {
    const svg = document.createElementNS(NS, "svg") as SVGSVGElement;
    svg.setAttribute("viewBox", "0 0 500 500");
    const nation = mkMoving(svg, "nation-label", 100, 112, 60, 12);
    const capital = mkMoving(svg, "city-label city-capital", 110, 114, 40, 10);
    deconflictLabels(svg, 4);
    const afterOne = nation.getAttribute("y");
    expect(afterOne).not.toBe("112");           // it did move off the capital
    deconflictLabels(svg, 4);
    expect(nation.getAttribute("y")).toBe(afterOne);
    deconflictLabels(svg, 4);
    expect(nation.getAttribute("y")).toBe(afterOne);
    expect(capital.style.visibility).toBe("");
  });

  it("clamps against the map, not against whatever the viewBox is zoomed to", () => {
    const svg = document.createElementNS(NS, "svg") as SVGSVGElement;
    svg.setAttribute("viewBox", "0 0 500 500");
    // a label sitting comfortably inside the map, far from the corner the zoom will show
    const far = mkLabel(svg, "region-label", { x: 300, y: 300, width: 80, height: 14 });
    far.setAttribute("x", "300"); far.setAttribute("y", "312");
    deconflictLabels(svg);
    expect(far.getAttribute("x")).toBe("300");   // nothing to clamp at base scale
    // now zoom into the top-left corner: the label is off-screen, and must NOT be dragged into view
    svg.setAttribute("viewBox", "0 0 125 125");
    deconflictLabels(svg);
    expect(far.getAttribute("x")).toBe("300");
    expect(far.getAttribute("y")).toBe("312");
  });
});

// Scale thresholds: at rest the map carries only the names of large things, and the smaller ones
// arrive as the reader leans in. Marks are not names — a town's dot stays, so the map still shows
// where the settlements are; it is the word beside it that waits for the zoom.
describe("deconflictLabels scale thresholds", () => {
  const build = () => {
    const svg = document.createElementNS(NS, "svg") as SVGSVGElement;
    svg.setAttribute("viewBox", "0 0 1000 700");
    return {
      svg,
      region: mkLabel(svg, "region-label", { x: 10, y: 10, width: 80, height: 14 }),
      capital: mkLabel(svg, "city-label city-capital", { x: 300, y: 300, width: 40, height: 10 }),
      river: mkLabel(svg, "river-label", { x: 500, y: 100, width: 50, height: 10 }),
      town: mkLabel(svg, "city-label city-town", { x: 700, y: 500, width: 30, height: 8 }),
    };
  };
  const shown = (el: SVGGraphicsElement) => el.style.visibility !== "hidden";

  // The capital used to be withheld here too, and the map opened as a field of unnamed specks
  // over its own best feature. It is named at rest now; the river and the town still wait.
  it("shows the regions and the capitals at rest, and holds the rest back", () => {
    const { svg, region, capital, river, town } = build();
    deconflictLabels(svg, 1);
    expect(shown(region)).toBe(true);
    expect(shown(capital)).toBe(true);
    expect(shown(river)).toBe(false);
    expect(shown(town)).toBe(false);
  });

  it("lets them in as the reader leans in, biggest first", () => {
    const { svg, capital, river, town } = build();
    deconflictLabels(svg, 1.5);
    expect([shown(capital), shown(river), shown(town)]).toEqual([true, false, false]);
    deconflictLabels(svg, 2);
    expect([shown(capital), shown(river), shown(town)]).toEqual([true, true, false]);
    deconflictLabels(svg, 2.6);
    expect([shown(capital), shown(river), shown(town)]).toEqual([true, true, true]);
  });

  it("takes them away again on the way back out", () => {
    const { svg, town } = build();
    deconflictLabels(svg, 4);
    expect(shown(town)).toBe(true);
    deconflictLabels(svg, 1);
    expect(shown(town)).toBe(false);
  });

  it("defaults to the resting scale when no zoom is given", () => {
    const { svg, region, town } = build();
    deconflictLabels(svg);
    expect(shown(region)).toBe(true);
    expect(shown(town)).toBe(false);
  });

  it("never lets a name held back for scale take up room a visible one could use", () => {
    const svg = document.createElementNS(NS, "svg") as SVGSVGElement;
    svg.setAttribute("viewBox", "0 0 1000 700");
    const town = mkLabel(svg, "city-label city-town", { x: 100, y: 100, width: 90, height: 12 });
    const region = mkLabel(svg, "region-label", { x: 100, y: 100, width: 90, height: 12 });
    deconflictLabels(svg, 1);   // the town is out of scale; it must not cull the region under it
    expect(shown(region)).toBe(true);
    expect(shown(town)).toBe(false);
  });
});

// The culture view's names were in no tier at all, so nothing culled them and nothing protected
// them: measured on three seeds, 5 / 4 / 1 overlapping pairs, and on seed 42 four of the five
// culture names sat under a region or city name. The culture view is ABOUT its cultures, so the
// name of one outranks the region and city names drawn under it.
describe("culture names", () => {
  it("outranks the region and city names it overlaps in the culture view", () => {
    const svg = document.createElementNS(NS, "svg") as SVGSVGElement;
    const culture = mkLabel(svg, "culture-label", { x: 0, y: 0, width: 60, height: 13 });
    const region = mkLabel(svg, "region-label", { x: 10, y: 2, width: 60, height: 12 });
    const town = mkLabel(svg, "city-label city-town", { x: 20, y: 4, width: 30, height: 8 });
    deconflictLabels(svg, 4);
    expect(culture.style.visibility).toBe("");
    expect(region.style.visibility).toBe("hidden");
    expect(town.style.visibility).toBe("hidden");
  });

  it("is shown at rest, not held back for a zoom (it names the view's own subject)", () => {
    const svg = document.createElementNS(NS, "svg") as SVGSVGElement;
    const culture = mkLabel(svg, "culture-label", { x: 0, y: 0, width: 60, height: 13 });
    deconflictLabels(svg, 1);
    expect(culture.style.visibility).toBe("");
  });
});

// The province view drew 100 names and showed none of them at rest -- they waited for 2x -- while
// the terrain layer's region names were drawn in every view, so the one view about provinces was
// captioned by somebody else's labels. The culture and political views both name their own subject
// at rest; this one now does too, and the cull decides how many fit rather than a scale gate.
describe("province names", () => {
  it("names the view's own subject at rest, biggest first", () => {
    const svg = document.createElementNS(NS, "svg") as SVGSVGElement;
    const big = mkLabel(svg, "province-label", { x: 0, y: 0, width: 40, height: 7 });
    const overlapping = mkLabel(svg, "province-label", { x: 5, y: 1, width: 40, height: 7 });
    const far = mkLabel(svg, "province-label", { x: 400, y: 400, width: 40, height: 7 });
    deconflictLabels(svg, 1);
    expect(big.style.visibility).toBe("");        // emitted first = the larger province
    expect(overlapping.style.visibility).toBe("hidden");
    expect(far.style.visibility).toBe("");
  });
});

// A capital's name used to wait for 1.5x zoom, so the first thing a reader saw was a field of
// unnamed specks — 0 of 28 names on screen at rest. Towns still wait (28 names at once is a
// thicket); the eight or so capitals are what make the map legible on arrival.
describe("the capitals are named on arrival", () => {
  it("shows a capital's name at the default zoom", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg") as SVGSVGElement;
    const mk = (cls: string, x: number) => {
      const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
      t.setAttribute("class", "city-label " + cls);
      t.textContent = "Somewhere";
      (t as unknown as { getBBox: () => DOMRect }).getBBox = () =>
        ({ x, y: 0, width: 20, height: 8 }) as DOMRect;
      svg.appendChild(t);
      return t;
    };
    const capital = mk("city-capital", 0);
    const town = mk("city-town", 200);
    deconflictLabels(svg, 1);
    expect(capital.style.visibility, "a capital is named at rest").not.toBe("hidden");
    expect(town.style.visibility, "a town still waits for the reader to lean in").toBe("hidden");
  });
});

// ★ A district's name was set exactly on its district's sign: measured over 336 plates, "대성당"
// lay over the cathedral's cross on 266 of 318 and "시장 광장" over the market cross and well on
// 321 of 336 — 39% of the names on the plates covered a sign. A map sets a name BESIDE its sign
// (Imhof's first rule of point labels is that the reader can tell which is which), above by
// preference; the name is what moves, since the sign marks the place.
describe("clearMarks", () => {
  const svgWith = () => document.createElementNS(NS, "svg") as SVGSVGElement;
  const mark = (svg: SVGSVGElement, cls: string, box: Box) => mkLabel(svg, cls, box);
  const label = (svg: SVGSVGElement, box: Box, y: number) => {
    const t = mkLabel(svg, "ward-label ward-landmark", box);
    t.setAttribute("y", String(y));
    return t;
  };

  it("lifts a name off its sign, above it", () => {
    const svg = svgWith();
    mark(svg, "landmark", { x: 96, y: 93, width: 8, height: 14 });          // a cross, 93..107
    const name = label(svg, { x: 85, y: 94, width: 30, height: 9 }, 100);  // the word, 94..103
    clearMarks(svg);
    const y = Number(name.getAttribute("y"));
    // the word's box bottom (103) must end above the cross's top (93), with air between
    expect(103 + (y - 100)).toBeLessThan(93);
    expect(y - 100, "moved further than it had to").toBeGreaterThan(-13);
  });

  it("leaves a name alone when no sign is under it", () => {
    const svg = svgWith();
    mark(svg, "well", { x: 300, y: 300, width: 3, height: 3 });
    const name = label(svg, { x: 85, y: 94, width: 30, height: 9 }, 100);
    clearMarks(svg);
    expect(name.getAttribute("y")).toBe("100");
  });

  it("goes below when there is another sign above", () => {
    const svg = svgWith();
    mark(svg, "market-cross-base", { x: 98, y: 96, width: 3, height: 3 });   // under the word
    mark(svg, "parish-church", { x: 96, y: 80, width: 4, height: 6 });       // right where "above" would land
    const name = label(svg, { x: 85, y: 92, width: 30, height: 9 }, 99);
    clearMarks(svg);
    const dy = Number(name.getAttribute("y")) - 99;
    expect(dy, "it went up onto the church").toBeGreaterThan(0);
    expect(92 + dy, "it did not clear the sign below").toBeGreaterThan(99);
  });

  it("keeps a name inside its town when the town has room on the other side", () => {
    const svg = svgWith();
    const town = document.createElementNS(NS, "polygon");
    town.setAttribute("class", "boundary");
    town.setAttribute("points", "50,90 150,90 150,200 50,200");   // the wall runs along y = 90
    svg.appendChild(town);
    mark(svg, "parish-church", { x: 96, y: 93, width: 8, height: 14 });
    const name = label(svg, { x: 85, y: 94, width: 30, height: 9 }, 100);
    clearMarks(svg);
    expect(Number(name.getAttribute("y")) - 100, "it went up over the wall").toBeGreaterThan(0);
  });

  it("moves district names only, never the plate's title", () => {
    const svg = svgWith();
    mark(svg, "landmark", { x: 96, y: 93, width: 8, height: 14 });
    const title = mkLabel(svg, "city-name-text", { x: 80, y: 94, width: 40, height: 12 });
    title.setAttribute("y", "104");
    clearMarks(svg);
    expect(title.getAttribute("y")).toBe("104");
  });

  it("does nothing where nothing can be measured", () => {
    const svg = svgWith();
    const t = document.createElementNS(NS, "text");
    t.setAttribute("class", "ward-label");
    t.setAttribute("y", "5");
    svg.appendChild(t);
    const p = document.createElementNS(NS, "path");
    p.setAttribute("class", "landmark");
    svg.appendChild(p);
    expect(() => clearMarks(svg)).not.toThrow();
    expect(t.getAttribute("y")).toBe("5");
  });
});

// ★ The castle's name lay on the castle: the engine names it at the most open spot of its yard, and a
// yard seldom has a name's worth of open court once its donjon and halls stand in it — measured on
// the page at 1440x900, the letters (with their halo) touched the castle's walls, towers or gates on
// 96 of 122 castles of twelve worlds. The name moves, as little as it must, to where it touches none
// of the castle: in the yard where there is room, beside the castle where there is none.
describe("clearCastleName", () => {
  type P = [number, number];
  const el = (svg: Element, tag: string, attrs: Record<string, string | number>) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    svg.appendChild(e);
    return e;
  };
  const pts = (ps: P[]) => ps.map((p) => p.join(",")).join(" ");
  const square = (x0: number, y0: number, x1: number, y1: number): P[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  // a plate with a town outline and a castle: a ring of wall (drawn 4.4 wide), a tower on each corner
  // and a donjon; `ring` is the enceinte's square, `keep` the donjon's
  const plate = (ring: [number, number, number, number], keep: [number, number, number, number], town: P[] = square(0, 0, 400, 400)) => {
    const svg = document.createElementNS(NS, "svg") as SVGSVGElement;
    el(svg, "polygon", { class: "boundary", points: pts(town) });
    const g = el(svg, "g", { class: "castle-inner" });
    const r = square(...ring);
    el(g, "polygon", { class: "castle-wall", points: pts(r), "stroke-width": 4.4 });
    for (const [x, y] of r) el(g, "circle", { class: "castle-tower", cx: x, cy: y, r: 2.8, "stroke-width": 0.9 });
    el(g, "polygon", { class: "castle-keep", points: pts(square(...keep)), "stroke-width": 1.4 });
    return svg;
  };
  // the castle's name: its line box as the page measures it, anchored at its middle and baseline
  const castleName = (svg: SVGSVGElement, x: number, y: number) => {
    const t = mkLabel(svg, "ward-label ward-landmark castle-name", { x: x - 6.75, y: y - 6.9, width: 13.5, height: 8.8 });
    t.setAttribute("x", String(x)); t.setAttribute("y", String(y));
    t.setAttribute("font-size", "7"); t.setAttribute("stroke-width", "2.2");
    return t;
  };
  // where the name's box (letters and halo) now stands
  const boxNow = (t: SVGGraphicsElement, x: number, y: number) => {
    const dx = Number(t.getAttribute("x")) - x, dy = Number(t.getAttribute("y")) - y;
    return { x0: x - 6.75 - 1.1 + dx, y0: y - 6.9 - 1.1 + dy, x1: x + 6.75 + 1.1 + dx, y1: y + 1.9 + 1.1 + dy, moved: Math.hypot(dx, dy) };
  };
  // how near the box comes to a ring's line (0 where it crosses)
  const toRing = (b: { x0: number; y0: number; x1: number; y1: number }, r: P[]) => {
    let d = Infinity;
    for (let i = 0; i < r.length; i++) {
      const a = r[i], c = r[(i + 1) % r.length];
      // the ring here is square to the plate, so each side is a horizontal or vertical run
      if (a[1] === c[1]) {
        const dx = Math.max(Math.min(a[0], c[0]) - b.x1, 0, b.x0 - Math.max(a[0], c[0]));
        const dy = a[1] < b.y0 ? b.y0 - a[1] : a[1] > b.y1 ? a[1] - b.y1 : 0;
        d = Math.min(d, Math.hypot(dx, dy));
      } else {
        const dy = Math.max(Math.min(a[1], c[1]) - b.y1, 0, b.y0 - Math.max(a[1], c[1]));
        const dx = a[0] < b.x0 ? b.x0 - a[0] : a[0] > b.x1 ? a[0] - b.x1 : 0;
        d = Math.min(d, Math.hypot(dx, dy));
      }
    }
    return d;
  };

  it("takes the name off the wall into the yard, where the yard has room", () => {
    const svg = plate([100, 100, 200, 200], [165, 140, 180, 155]);
    const t = castleName(svg, 102, 150);                 // across the west wall
    clearCastleName(svg);
    const b = boxNow(t, 102, 150);
    expect(toRing(b, square(100, 100, 200, 200)), "still on the wall").toBeGreaterThanOrEqual(2.2);
    expect(b.x0 > 100 && b.x1 < 200 && b.y0 > 100 && b.y1 < 200, "left the yard it fits in").toBe(true);
    expect(b.moved, "moved further than it had to").toBeLessThan(12);
  });

  it("sets the name beside a castle whose yard cannot hold it", () => {
    const svg = plate([100, 100, 116, 116], [105, 105, 111, 111]);
    const t = castleName(svg, 108, 112);
    clearCastleName(svg);
    const b = boxNow(t, 108, 112);
    expect(toRing(b, square(100, 100, 116, 116)), "on the wall").toBeGreaterThanOrEqual(2.2);
    expect(b.x1 < 100 || b.x0 > 116 || b.y1 < 100 || b.y0 > 116, "on the castle").toBe(true);
    expect(b.moved, "wandered off from the castle").toBeLessThan(25);
  });

  it("keeps to the town when the nearest clear ground is over the town wall", () => {
    // the town's wall runs along x = 100 with the castle against it on the inside, and the signs of
    // the town hem the castle in above, below and to the east: the nearest open ground is the
    // country across the wall, and the name stays in the town all the same
    const svg = plate([100, 150, 116, 166], [105, 155, 111, 161], square(100, 0, 400, 400));
    el(svg, "polyline", { class: "wall-seg", points: pts([[100, 0], [100, 400]]), "stroke-width": 4 });
    mkLabel(svg, "landmark", { x: 118, y: 120, width: 22, height: 80 });
    mkLabel(svg, "well", { x: 95, y: 100, width: 45, height: 48 });
    mkLabel(svg, "well", { x: 95, y: 168, width: 45, height: 47 });
    const t = castleName(svg, 108, 162);
    clearCastleName(svg);
    const b = boxNow(t, 108, 162);
    expect(b.x0, "went over the town wall").toBeGreaterThan(102);
    expect(toRing(b, square(100, 150, 116, 166))).toBeGreaterThanOrEqual(2.2);
  });

  it("keeps the air the cull needs from another name, so neither is taken", () => {
    const svg = plate([100, 100, 116, 116], [105, 105, 111, 111]);
    // a quarter's name just under the spot the castle's would otherwise take, below the castle —
    // clear of it, but nearer than the air the cull keeps between two names
    mkLabel(svg, "ward-label", { x: 95, y: 132, width: 26, height: 9 });
    const t = castleName(svg, 108, 112);
    clearCastleName(svg);
    const b = boxNow(t, 108, 112);
    const other = { x0: 95 - 4, y0: 132 - 4, x1: 121 + 4, y1: 141 + 4 };
    const line = { x0: b.x0 + 1.1, y0: b.y0 + 1.1, x1: b.x1 - 1.1, y1: b.y1 - 1.1 };
    expect(line.x0 < other.x1 && other.x0 < line.x1 && line.y0 < other.y1 && other.y0 < line.y1, "within the other name's air").toBe(false);
  });

  it("leaves a name that touches nothing where it is", () => {
    const svg = plate([100, 100, 200, 200], [165, 165, 180, 180]);
    const t = castleName(svg, 130, 140);
    clearCastleName(svg);
    expect(t.getAttribute("x")).toBe("130");
    expect(t.getAttribute("y")).toBe("140");
  });

  it("does nothing where there is no castle, or nothing can be measured", () => {
    const bare = document.createElementNS(NS, "svg") as SVGSVGElement;
    const t = castleName(bare, 50, 50);
    expect(() => clearCastleName(bare)).not.toThrow();
    expect(t.getAttribute("x")).toBe("50");
    const svg = plate([100, 100, 116, 116], [105, 105, 111, 111]);
    const u = document.createElementNS(NS, "text");
    u.setAttribute("class", "ward-label castle-name");
    u.setAttribute("x", "108");
    svg.appendChild(u);
    expect(() => clearCastleName(svg)).not.toThrow();
    expect(u.getAttribute("x")).toBe("108");
  });
});
