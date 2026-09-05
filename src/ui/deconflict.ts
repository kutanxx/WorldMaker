// Hide any label whose bounding box overlaps a higher-priority one (player nation > other nation >
// capital > region > river > town), so nation names and place names don't collide. Runs post-mount
// because it needs getBBox (real layout); jsdom lacks getBBox, so it's a no-op in tests unless
// getBBox is stubbed. Pure DOM — not seeded, safe for determinism.
export function deconflictLabels(svg: SVGSVGElement): void {
  const tiers: [string, number][] = [
    [".nation-label.player", 6], [".nation-label:not(.player)", 5], [".city-capital", 4],
    [".region-label", 3], [".province-label", 3], [".river-label", 2], [".city-town", 1],
  ];
  const labels: { el: SVGGraphicsElement; box: DOMRect; prio: number }[] = [];
  try {
    for (const [sel, prio] of tiers) {
      for (const el of svg.querySelectorAll<SVGGraphicsElement>(sel)) {
        el.style.visibility = ""; // reset any prior pass
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
