import { pointInPolygon, type Point } from "../engine/geometry";
// Hide any label whose bounding box overlaps a higher-priority one (player nation > other nation >
// capital > region > river > town), so nation names and place names don't collide. Runs post-mount
// because it needs getBBox (real layout); jsdom lacks getBBox, so it's a no-op in tests unless
// getBBox is stubbed. Pure DOM — not seeded, safe for determinism.
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
  const AIR = 4;

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
 *  cross and well, a parish church's steeple, the castle's keep. */
const SIGNS = ".landmark, .market-cross-base, .market-cross, .well, .parish-church, .castle-keep";

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

type Box = { x: number; y: number; width: number; height: number };
