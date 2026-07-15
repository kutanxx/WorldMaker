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
  // clamp pass: a label anchored near the map edge spills past the viewBox (text-anchor:middle
  // at an edge centroid), and the HUD shell's stretched svg renders that spill on the parchment
  // letterbox band instead of clipping it. Shift such labels back inside the frame. Rivers are
  // excluded — they're rotated, so their local-space bbox can't be corrected with an x/y shift.
  const vb = (svg.getAttribute("viewBox") || "").split(/[\s,]+/).map(Number);
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
  const kept: DOMRect[] = [];
  const hit = (a: DOMRect, b: DOMRect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  for (const l of labels) {
    if (kept.some((k) => hit(k, l.box))) l.el.style.visibility = "hidden";
    else kept.push(l.box);
  }
}
