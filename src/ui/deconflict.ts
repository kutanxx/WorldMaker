import { pointInPolygon, type Point } from "../engine/geometry";
// Hide any label whose bounding box overlaps a higher-priority one (player nation > other nation >
// capital > region > river > town), so nation names and place names don't collide. Runs post-mount
// because it needs getBBox (real layout); jsdom lacks getBBox, so it's a no-op in tests unless
// getBBox is stubbed. Pure DOM — not seeded, safe for determinism.

// the air one name keeps from another, or the cull takes one of them (see deconflictLabels)
const NAME_AIR = 4;

/**
 * `scale` is the map's current zoom, 1 at rest. At rest the map carries only the names of large
 * things — realms and regions — and the smaller ones arrive as the reader leans in: the realm's
 * seat first, then rivers, then towns. Marks are not names: a settlement's dot stays at every zoom,
 * so the map always shows WHERE the towns are, and it is the word beside it that waits.
 *
 * The thresholds below are the one place in this pass with hand-chosen numbers. Everything else
 * follows from what fits.
 */
export function deconflictLabels(svg: SVGSVGElement, scale = 1): void {
  // selector, priority when they compete, and the zoom at which the name is worth the room.
  // A capital's name waits for no zoom either. It used to wait for 1.5x, which meant the map opened
  // as a field of unnamed specks -- 0 of 28 names on screen at rest -- with its best feature, the
  // city plans, sitting behind dots the reader had no reason to click. Towns still wait: 28 names
  // at once is a thicket, and the eight or so capitals are what make the map legible on arrival.
  // A province's name waits for no zoom: its view is about provinces, and it was the only view whose
  // own subject went unnamed at rest while the terrain layer's region names were drawn over it. A
  // hundred of them do not fit, and they are not meant to -- they are emitted largest-first, so the
  // cull below keeps the big ones and the rest arrive as the reader leans in.
  const tiers: [string, number, number][] = [
    [".nation-label.player", 6, 0], [".nation-label:not(.player)", 5, 0], [".city-capital", 4, 0],
    [".region-label:not(.region-faint)", 3, 0], [".province-label", 3, 0],
    // a faded region name yields to whatever the view is actually about
    [".region-label.region-faint", 1, 0], [".river-label", 2, 2], [".city-town", 1, 2.6],
    // the culture view is about its cultures, so a culture's name outranks the region and city names
    // drawn beneath it, and is there from the start rather than waiting for a zoom. It shares the
    // realm tier without ever competing with it: the two are never drawn in the same view.
    [".culture-label", 5, 0],
    // the city plan: its landmarks outrank its ordinary quarters, and both belong to a drawing
    // read at one scale, so neither waits for a zoom
    [".ward-landmark", 4, 0], [".ward-label:not(.ward-landmark)", 2, 0],
  ];
  const labels: { el: SVGGraphicsElement; box: DOMRect; prio: number }[] = [];
  try {
    for (const [sel, prio, minScale] of tiers) {
      for (const el of svg.querySelectorAll<SVGGraphicsElement>(sel)) {
        el.style.visibility = ""; // reset any prior pass
        if (scale < minScale) {
          // Held back for scale, and left out of `labels` entirely — a name nobody can see must not
          // occupy room a visible one could have used.
          el.style.visibility = "hidden";
          continue;
        }
        labels.push({ el, box: el.getBBox(), prio });
      }
    }
  } catch {
    return; // getBBox unavailable (e.g. jsdom) → skip culling, keep all labels visible
  }
  const hit = (a: DOMRect, b: DOMRect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

  // Two names that merely miss each other still read as one stack: measured on seed 7, a pair of
  // region names sat 3 units apart with 29 units of horizontal overlap and both survived, because
  // their boxes did not strictly intersect. A label needs air around it, not just the absence of a
  // collision. Only the candidate is grown when culling, so the clearance asked for is AIR and not
  // twice it, and the legend goes on occupying exactly the space it covers.
  const AIR = NAME_AIR;

  // separation pass, before any culling: a nation's name sits at the centroid of its territory and
  // its capital usually sits near that centroid too, so the two overlap — and the capital, being the
  // lower tier, is what vanished. Measured on seed 7's political view, three of eight capitals were
  // lost this way, on the one view where a capital matters most. The nation's name is what moves:
  // the capital's label is tied to a marker on the map and cannot be shifted without pointing at the
  // wrong place, while a nation's name only has to sit somewhere inside its own territory. Runs
  // before the clamp pass so a name lifted past the frame is brought back inside.
  // Must clear AIR (the culling gap below), or the separation pass lifts a nation's name off its
  // capital only for the culling pass to delete it for sitting too close to what it just cleared.
  const CAPITAL_GAP = AIR + 1;
  const capitals = labels.filter((l) => l.el.classList.contains("city-capital"));
  if (capitals.length) {
    // How much else a name would sit on top of, if it moved by dy. Moving a nation's name off its
    // capital costs nothing if it lands on open parchment and costs a region name if it does not —
    // measured over seven seeds, always lifting it upward recovered five capitals but buried three
    // region names, so the direction is chosen rather than assumed.
    const collisionsAt = (self: typeof labels[number], dy: number) => {
      const moved = { x: self.box.x, y: self.box.y + dy, width: self.box.width, height: self.box.height } as DOMRect;
      let k = 0;
      for (const o of labels) if (o !== self && hit(moved, o.box)) k++;
      return k;
    };
    for (const nat of labels) {
      if (!nat.el.classList.contains("nation-label")) continue;
      const clash = capitals.find((c) => hit(nat.box, c.box));
      if (!clash) continue;
      const up = clash.box.y - CAPITAL_GAP - (nat.box.y + nat.box.height);
      const down = clash.box.y + clash.box.height + CAPITAL_GAP - nat.box.y;
      const dy = collisionsAt(nat, up) <= collisionsAt(nat, down) ? up : down;
      nat.el.setAttribute("y", String(Number(nat.el.getAttribute("y") || 0) + dy));
      nat.box.y += dy;
    }
  }

  // clamp pass: a label anchored near the map edge spills past the viewBox (text-anchor:middle
  // at an edge centroid), and the HUD shell's stretched svg renders that spill on the parchment
  // letterbox band instead of clipping it. Shift such labels back inside the frame. Rivers are
  // excluded — they're rotated, so their local-space bbox can't be corrected with an x/y shift.
  //
  // Clamped against the map, not against the CURRENT viewBox. Zooming rewrites the viewBox to a
  // sub-rectangle, and clamping to that would drag every off-screen label into the visible corner —
  // a region's name yanked hundreds of units from the land it names. The map's own box is captured
  // the first time this runs, before any zoom has touched it.
  if (!svg.dataset.baseViewbox) svg.dataset.baseViewbox = svg.getAttribute("viewBox") || "";
  const vb = (svg.dataset.baseViewbox || "").split(/[\s,]+/).map(Number);
  if (vb.length === 4 && vb.every(Number.isFinite)) {
    const [vx, vy, vw, vh] = vb;
    const PAD = 10; // stay inside the decorative border (inset 8) with a little air
    for (const l of labels) {
      if (l.el.classList.contains("river-label")) continue;
      let dx = 0, dy = 0;
      if (l.box.x < vx + PAD) dx = vx + PAD - l.box.x;
      else if (l.box.x + l.box.width > vx + vw - PAD) dx = vx + vw - PAD - (l.box.x + l.box.width);
      if (l.box.y < vy + PAD) dy = vy + PAD - l.box.y;
      else if (l.box.y + l.box.height > vy + vh - PAD) dy = vy + vh - PAD - (l.box.y + l.box.height);
      if (dx !== 0) { l.el.setAttribute("x", String(Number(l.el.getAttribute("x") || 0) + dx)); l.box.x += dx; }
      if (dy !== 0) { l.el.setAttribute("y", String(Number(l.el.getAttribute("y") || 0) + dy)); l.box.y += dy; }
    }
  }

  labels.sort((a, b) => b.prio - a.prio); // place the important ones first
  // Things the map draws that are not in the tiers above, and that nothing may sit on. The legend is
  // an opaque panel, and a label underneath it was left "visible" while being covered — at 92% panel
  // opacity that is not a name, it is a smudge showing through. The world's title is the same case
  // from the other side: it was invisible to this pass, so it neither ceded space nor claimed any,
  // and a region name would come to rest just below it and read as a subtitle. Seeding both as
  // already-occupied lets the culling below reason about the room that is actually free.
  const kept: DOMRect[] = [];
  for (const panel of svg.querySelectorAll<SVGGraphicsElement>(".legend, .world-name-text")) {
    try { kept.push(panel.getBBox()); } catch { /* no layout (jsdom): nothing to reserve */ }
  }
  const withAir = (b: DOMRect) =>
    ({ x: b.x - AIR, y: b.y - AIR, width: b.width + AIR * 2, height: b.height + AIR * 2 }) as DOMRect;
  for (const l of labels) {
    if (kept.some((k) => hit(k, withAir(l.box)))) l.el.style.visibility = "hidden";
    else kept.push(l.box);
  }
}

/** The signs a city plate draws at a district's own place: the cathedral's cross, the market's
 *  cross and well, a parish church's steeple, the castle's keep — and the two buildings a town has
 *  only one of, the cathedral's church and the guild's hall, which a name is set beside, not on. */
const SIGNS = ".landmark, .market-cross-base, .market-cross, .well, .parish-church, .castle-keep, .cathedral-church, .guild-hall";

/**
 * Set each district's name BESIDE the sign at its place, not on it.
 *
 * The engine names a district at its middle and draws the district's sign there too, so the name
 * lay on the sign: measured over 336 plates, "대성당" covered the cathedral's cross on 266 of 318
 * and "시장 광장" the market cross and well on 321 of 336 — 39% of all the names on the plates sat
 * on a sign. Imhof's rule for a point's name is that the reader can tell which name is which
 * sign's, above by preference. The name moves, since the sign marks the place: up until its box
 * clears every sign it covered, or down if that would land it on another sign.
 *
 * Run it on the names at the size they will be READ (after any floor), before the cull. Zooming in
 * afterwards only shrinks a name toward its baseline against the drawing, which keeps it clear.
 * ⚠ A DOMRect's fields are prototype getters, so a moved box is built field by field, never spread.
 */
export function clearMarks(svg: SVGSVGElement, labels = ".ward-label", signs = SIGNS, air = 1.5): void {
  const hit = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  // a district's name belongs inside its town: of two clear places, the one in the town wins (a
  // steeple under a name by the wall sent 8 of 1,783 names over it, measured at 1440x900)
  const outline = (svg.querySelector(".boundary")?.getAttribute("points") ?? "").trim();
  const town: Point[] = outline ? outline.split(/\s+/).map((q) => q.split(",").map(Number) as Point) : [];
  const inTown = (b: Box) => town.length < 3 || pointInPolygon([b.x + b.width / 2, b.y + b.height / 2], town);
  let marks: Box[];
  try {
    marks = [...svg.querySelectorAll<SVGGraphicsElement>(signs)]
      .map((m) => m.getBBox())
      .filter((b) => b && (b.width > 0 || b.height > 0));
  } catch {
    return; // no layout (jsdom): nothing to measure, nothing moved
  }
  if (marks.length === 0) return;
  for (const el of svg.querySelectorAll<SVGGraphicsElement>(labels)) {
    let b: Box;
    try { b = el.getBBox(); } catch { return; }
    if (!b || !(b.width > 0)) continue;
    const grown = { x: b.x - air, y: b.y - air, width: b.width + air * 2, height: b.height + air * 2 };
    const under = marks.filter((m) => hit(grown, m));
    if (under.length === 0) continue;
    const top = Math.min(...under.map((m) => m.y));
    const bottom = Math.max(...under.map((m) => m.y + m.height));
    const up = top - air - (b.y + b.height);
    const down = bottom + air - b.y;
    const at = (dy: number): Box => ({ x: b.x, y: b.y + dy, width: b.width, height: b.height });
    const clear = (dy: number) => !marks.some((m) => hit(at(dy), m));
    const dy = [up, down].find((d) => clear(d) && inTown(at(d))) ?? [up, down].find(clear) ?? up;
    el.setAttribute("y", (Number(el.getAttribute("y") || 0) + dy).toFixed(2));
  }
}

type Pt = [number, number];
// what a name may not lie on: a stroked line (its ink reaches `half` either side), a disc, a filled
// shape with its outline, or a box
type Ink =
  | { k: "line"; a: Pt; b: Pt; half: number }
  | { k: "disc"; c: Pt; r: number }
  | { k: "fill"; pts: Pt[]; half: number }
  | { k: "box"; b: Edges };
type Edges = { x0: number; y0: number; x1: number; y1: number };

const attr = (el: Element, a: string) => Number(el.getAttribute(a) ?? 0) || 0;
const pointsOf = (el: Element): Pt[] =>
  (el.getAttribute("points") ?? "").trim().split(/\s+/).filter(Boolean).map((q) => q.split(",").map(Number) as Pt);
const toBox = (x0: number, y0: number, x1: number, y1: number): Edges => ({ x0, y0, x1, y1 });
const boxPoint = (b: Edges, p: Pt) => Math.hypot(Math.max(b.x0 - p[0], 0, p[0] - b.x1), Math.max(b.y0 - p[1], 0, p[1] - b.y1));
const pointSeg = (p: Pt, a: Pt, b: Pt) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
};
// a segment through the box (Liang-Barsky)
const crossesBox = (a: Pt, c: Pt, b: Edges) => {
  let t0 = 0, t1 = 1;
  const dx = c[0] - a[0], dy = c[1] - a[1];
  for (const [p, q] of [[-dx, a[0] - b.x0], [dx, b.x1 - a[0]], [-dy, a[1] - b.y0], [dy, b.y1 - a[1]]]) {
    if (p === 0) { if (q < 0) return false; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
  }
  return true;
};
const segToBox = (a: Pt, c: Pt, b: Edges) => crossesBox(a, c, b) ? 0 : Math.min(
  boxPoint(b, a), boxPoint(b, c),
  pointSeg([b.x0, b.y0], a, c), pointSeg([b.x1, b.y0], a, c), pointSeg([b.x0, b.y1], a, c), pointSeg([b.x1, b.y1], a, c));
const inside = (p: Pt, poly: Pt[]) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};
const lies = (b: Edges, s: Ink): boolean => {
  switch (s.k) {
    case "line": return segToBox(s.a, s.b, b) < s.half;
    case "disc": return boxPoint(b, s.c) < s.r;
    case "box": return s.b.x0 < b.x1 && b.x0 < s.b.x1 && s.b.y0 < b.y1 && b.y0 < s.b.y1;
    case "fill": {
      if (inside([(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2], s.pts)) return true;
      if (s.pts.some((p) => p[0] >= b.x0 && p[0] <= b.x1 && p[1] >= b.y0 && p[1] <= b.y1)) return true;
      for (let i = 0; i < s.pts.length; i++) if (segToBox(s.pts[i], s.pts[(i + 1) % s.pts.length], b) < s.half) return true;
      return false;
    }
  }
};
// the ink of every element a selector finds, as it is drawn: outlines and lines by their stroke,
// discs by radius and stroke, filled shapes with their outline
function inkOf(svg: SVGSVGElement, sel: { lines?: string; rings?: string; discs?: string; fills?: string }): Ink[] {
  const out: Ink[] = [];
  const half = (el: Element) => attr(el, "stroke-width") / 2;
  const edges = (pts: Pt[], closed: boolean, h: number) => {
    for (let i = 0; i + 1 < pts.length + (closed ? 1 : 0); i++) out.push({ k: "line", a: pts[i], b: pts[(i + 1) % pts.length], half: h });
  };
  if (sel.lines) for (const el of svg.querySelectorAll(sel.lines)) edges(pointsOf(el), false, half(el));
  if (sel.rings) for (const el of svg.querySelectorAll(sel.rings)) edges(pointsOf(el), true, half(el));
  if (sel.discs) for (const el of svg.querySelectorAll(sel.discs)) out.push({ k: "disc", c: [attr(el, "cx"), attr(el, "cy")], r: attr(el, "r") + half(el) });
  if (sel.fills) for (const el of svg.querySelectorAll(sel.fills)) {
    if (el.tagName.toLowerCase() === "rect") {
      const x = attr(el, "x"), y = attr(el, "y"), w = attr(el, "width"), h = attr(el, "height");
      out.push({ k: "fill", pts: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], half: half(el) });
    } else out.push({ k: "fill", pts: pointsOf(el), half: half(el) });
  }
  return out;
}

// the castle as it is drawn — its rings of wall, its towers and turrets, its gates and gate block,
// and the donjon — and the town wall a castle stands on. Not its halls: they are roofed buildings in
// the yard, and a name stands over buildings everywhere else on the plate.
const CASTLE_INK = {
  rings: "g.castle-inner polygon.castle-wall, g.castle-inner polygon.castle-outer-wall",
  discs: "g.castle-inner circle",
  fills: "g.castle-inner polygon.castle-keep, g.castle-inner polygon.castle-gatehouse-block, g.castle-inner rect.castle-gate",
};
const TOWN_WALL_INK = { lines: "polyline.wall-seg", discs: "circle.tower", fills: "rect.gate" };

/**
 * Set the castle's name where it lies on none of the castle.
 *
 * The engine names a castle at the most open spot of its ground, its yard first — and a yard seldom
 * has a name's worth of open court once its donjon and halls stand in it: measured on the page at
 * 1440x900, the name (as drawn, halo and all) lay on the castle's walls or towers on 113 of 122
 * castles of twelve worlds. So the name moves, as little as it must, to where it touches none of
 * the castle's drawn parts: still in the yard where the yard has room, and where it has none, just
 * outside the walls — the rule of a small feature's name, which stands beside it. It stays off the
 * town wall and the plate's signs always; and inside the town, off the water and off the other names
 * unless nothing near is clear of them — the other names give way first, then the water, then the town.
 *
 * Run it on the names at the size they will be READ, after `clearMarks` (which may have moved the
 * castle's name off its donjon) and before the cull. Zooming in afterwards only shrinks a name toward
 * its anchor, which keeps it clear.
 */
export function clearCastleName(svg: SVGSVGElement, air = 0.3, reach = 45): void {
  const name = svg.querySelector<SVGGraphicsElement>("text.castle-name");
  if (!name || !svg.querySelector("g.castle-inner")) return;
  const ink = glyphEdges(name);
  if (!ink) return;
  // the letters and the parchment halo behind them, and a little air
  const pad = attr(name, "stroke-width") / 2 + air;
  const at = toBox(ink.x0 - pad, ink.y0 - pad, ink.x1 + pad, ink.y1 + pad);
  const near = (s: Ink) => {
    const r = reach + Math.max(at.x1 - at.x0, at.y1 - at.y0);
    const c: Pt = [(at.x0 + at.x1) / 2, (at.y0 + at.y1) / 2];
    switch (s.k) {
      case "line": return pointSeg(c, s.a, s.b) < r + s.half;
      case "disc": return Math.hypot(s.c[0] - c[0], s.c[1] - c[1]) < r + s.r;
      case "box": return boxPoint(s.b, c) < r;
      case "fill": return s.pts.some((p) => Math.hypot(p[0] - c[0], p[1] - c[1]) < r + 20);
    }
  };
  const hard = [...inkOf(svg, CASTLE_INK), ...inkOf(svg, TOWN_WALL_INK)].filter(near);
  const boxes = (els: Iterable<SVGGraphicsElement>): Ink[] => {
    const out: Ink[] = [];
    for (const el of els) {
      try {
        const m = el.getBBox();
        if (m && (m.width > 0 || m.height > 0)) out.push({ k: "box", b: toBox(m.x, m.y, m.x + m.width, m.y + m.height) });
      } catch { /* not measurable: nothing to keep off */ }
    }
    return out;
  };
  const signs = boxes(svg.querySelectorAll<SVGGraphicsElement>(SIGNS)).filter(near);
  // the other names, with the air the cull keeps between two names — nearer, and one of them goes
  const names = boxes([...svg.querySelectorAll<SVGGraphicsElement>(".ward-label")]
    .filter((el) => el !== name && el.style.visibility !== "hidden"))
    .map((s) => (s.k === "box" ? { k: "box" as const, b: toBox(s.b.x0 - NAME_AIR, s.b.y0 - NAME_AIR, s.b.x1 + NAME_AIR, s.b.y1 + NAME_AIR) } : s))
    .filter(near);
  const outline = svg.querySelector(".boundary");
  const town = outline ? pointsOf(outline) : [];
  // the water as far as it is drawn: its shallows, under the deeper blue
  const water = [...svg.querySelectorAll("polygon.water-shallow")].map(pointsOf);
  const wet = (p: Pt) => water.some((w) => inside(p, w));
  // (each piece of ink filed under the cells of a coarse grid it reaches into, so a spot is tested
  // against the few pieces near it and not the hundred on the plate — the same answer, faster)
  const solid = inkGrid([...hard, ...signs]), others = inkGrid(names);
  // how much a spot keeps to: 3 = everything, 2 = all but the other names, 1 = the town only, 0 = none
  const level = (bx: Edges): number => {
    if (solid.touches(bx)) return -1;
    const mid: Pt = [(bx.x0 + bx.x1) / 2, (bx.y0 + bx.y1) / 2];
    if (town.length >= 3 && !inside(mid, town)) return 0;
    if (wet(mid)) return 1;
    return others.touches(bx) ? 2 : 3;
  };
  if (level(at) === 3) return;   // it touches nothing: it stays where the engine put it
  // the nearest spot that keeps to everything; failing that, the nearest that keeps to the most
  const best: (Pt | null)[] = [null, null, null, null];
  for (const [dx, dy] of offsetsWithin(reach)) {
    const l = level(toBox(at.x0 + dx, at.y0 + dy, at.x1 + dx, at.y1 + dy));
    for (let k = 0; k <= l; k++) best[k] ??= [dx, dy];
    if (l === 3) break;
  }
  const to = best[3] ?? best[2] ?? best[1] ?? best[0];
  if (!to) return;
  name.setAttribute("x", (attr(name, "x") + to[0]).toFixed(2));
  name.setAttribute("y", (attr(name, "y") + to[1]).toFixed(2));
}

/**
 * The letters' own extent. A text's box (`getBBox`) is the font's whole line — its ascent and descent,
 * 8.8 units tall for a 7-unit "성채" whose letters ink 6.8 (and "Castle" 5.1) — and set against the
 * castle, that phantom top and bottom pushed names out of yards they stood in clear. The glyphs are
 * measured on a canvas in the name's own font, once per font and word; where there is no canvas the
 * line box stands in.
 */
const GLYPHS = new Map<string, { l: number; r: number; a: number; d: number }>();
let glyphPen: CanvasRenderingContext2D | null | undefined;
function glyphEdges(t: SVGGraphicsElement): Edges | null {
  let line: Box | null = null;
  try { line = t.getBBox(); } catch { /* not laid out */ }
  if (!line || !(line.width > 0)) return null;
  const lineBox = toBox(line.x, line.y, line.x + line.width, line.y + line.height);
  if (glyphPen === undefined) {
    // (no canvas at all where there is no layout either — jsdom — and asking for one there only complains)
    try { glyphPen = typeof CanvasRenderingContext2D === "undefined" ? null : document.createElement("canvas").getContext("2d") ?? null; } catch { glyphPen = null; }
  }
  const text = t.textContent ?? "";
  if (!glyphPen || !text) return lineBox;
  const cs = getComputedStyle(t);
  const key = `${cs.fontStyle}|${cs.fontWeight}|${cs.fontFamily}|${text}`;
  let g = GLYPHS.get(key);
  if (!g) {
    glyphPen.font = `${cs.fontStyle} ${cs.fontWeight} 100px ${cs.fontFamily}`;
    glyphPen.textAlign = "center";           // the name is anchored at its middle, as the page sets it
    glyphPen.textBaseline = "alphabetic";    // ...and at its baseline
    const m = glyphPen.measureText(text);
    if (!(m.actualBoundingBoxAscent > 0) || !(m.actualBoundingBoxLeft + m.actualBoundingBoxRight > 0)) return lineBox;
    g = { l: m.actualBoundingBoxLeft / 100, r: m.actualBoundingBoxRight / 100, a: m.actualBoundingBoxAscent / 100, d: m.actualBoundingBoxDescent / 100 };
    GLYPHS.set(key, g);
  }
  const fs = attr(t, "font-size"), x = attr(t, "x"), y = attr(t, "y");
  if (!(fs > 0)) return lineBox;
  return toBox(x - g.l * fs, y - g.a * fs, x + g.r * fs, y + g.d * fs);
}

// Every spot within reach, nearest first — finely near the name, coarser further out — and of two
// equally near, the one above (a name above its thing, by preference). Built once for each reach.
const OFFSETS = new Map<number, Pt[]>();
function offsetsWithin(reach: number): Pt[] {
  let out = OFFSETS.get(reach);
  if (out) return out;
  out = [];
  for (let dy = -reach; dy <= reach; dy += 0.5) for (let dx = -reach; dx <= reach; dx += 0.5) {
    const d = Math.hypot(dx, dy);
    if (d > reach || (d > 12 && (dx % 1 !== 0 || dy % 1 !== 0))) continue;
    out.push([dx, dy]);
  }
  out.sort((u, v) => Math.hypot(u[0], u[1]) - Math.hypot(v[0], v[1]) || u[1] - v[1] || u[0] - v[0]);
  OFFSETS.set(reach, out);
  return out;
}

// pieces of ink filed by the grid cells their boxes reach into
const INK_CELL = 8;
function inkGrid(ink: Ink[]): { touches: (b: Edges) => boolean } {
  const cells = new Map<number, number[]>();
  const key = (ix: number, iy: number) => (ix + 2048) * 4096 + (iy + 2048);
  const span = (s: Ink): Edges => {
    switch (s.k) {
      case "line": return toBox(Math.min(s.a[0], s.b[0]) - s.half, Math.min(s.a[1], s.b[1]) - s.half, Math.max(s.a[0], s.b[0]) + s.half, Math.max(s.a[1], s.b[1]) + s.half);
      case "disc": return toBox(s.c[0] - s.r, s.c[1] - s.r, s.c[0] + s.r, s.c[1] + s.r);
      case "box": return s.b;
      case "fill": {
        const xs = s.pts.map((p) => p[0]), ys = s.pts.map((p) => p[1]);
        return toBox(Math.min(...xs) - s.half, Math.min(...ys) - s.half, Math.max(...xs) + s.half, Math.max(...ys) + s.half);
      }
    }
  };
  ink.forEach((s, i) => {
    const e = span(s);
    for (let ix = Math.floor(e.x0 / INK_CELL); ix <= Math.floor(e.x1 / INK_CELL); ix++)
      for (let iy = Math.floor(e.y0 / INK_CELL); iy <= Math.floor(e.y1 / INK_CELL); iy++) {
        const k = key(ix, iy);
        const list = cells.get(k);
        if (list) list.push(i); else cells.set(k, [i]);
      }
  });
  const seen = new Int32Array(ink.length);
  let stamp = 0;
  return {
    touches(b: Edges) {
      stamp++;
      for (let ix = Math.floor(b.x0 / INK_CELL); ix <= Math.floor(b.x1 / INK_CELL); ix++)
        for (let iy = Math.floor(b.y0 / INK_CELL); iy <= Math.floor(b.y1 / INK_CELL); iy++) {
          const list = cells.get(key(ix, iy));
          if (!list) continue;
          for (const i of list) {
            if (seen[i] === stamp) continue;
            seen[i] = stamp;
            if (lies(b, ink[i])) return true;
          }
        }
      return false;
    },
  };
}

type Box = { x: number; y: number; width: number; height: number };
