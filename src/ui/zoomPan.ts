// viewBox-based zoom/pan for an SVG map (world or city). Simple visual zoom — markers/labels
// scale with the map. No dependencies. Read/write the viewBox as an attribute string (jsdom
// does not implement svg.viewBox.baseVal).
export interface ZoomPan { reset(): void; destroy(): void; viewBox(): string; scale(): number; }

const MIN_SCALE = 1, MAX_SCALE = 8;
// straight-line px from the press point beyond which a pointer sequence is a drag (pan), not a
// click (drilldown). Generous enough that a trackpad click's few px of jitter still counts as a
// click — otherwise the map swallows the click and the city never opens.
const DRAG_PX = 8;

export function attachZoomPan(
  svg: SVGSVGElement,
  container: HTMLElement,
  // `onScale` fires whenever the zoom changes, so the caller can hold the lettering at its
  // on-screen size and let deconflictLabels work out what now fits (see labelScale.ts).
  opts?: { restore?: string | null; onScale?: (scale: number) => void },
): ZoomPan {
  const parse = (s: string | null) => { const a = (s || "0 0 100 100").split(/[\s,]+/).map(Number); return { x: a[0], y: a[1], w: a[2], h: a[3] }; };
  const base = parse(svg.getAttribute("viewBox"));
  let cur = { ...base };
  // at base scale the map yields the touch surface to the page (scroll passes through, taps
  // still land); zoomed in, the map owns it (one-finger pan, and pinch arrives as pointers)
  const syncTouchAction = () => { svg.style.touchAction = cur.w < base.w - 1e-9 ? "none" : "pan-y"; };
  let lastScale = 0;
  const apply = () => {
    svg.setAttribute("viewBox", `${cur.x} ${cur.y} ${cur.w} ${cur.h}`);
    syncTouchAction();
    // panning does not change the scale, and re-laying every label out on each pointermove would be
    // wasted work, so only a real zoom notifies.
    const s = base.w / cur.w;
    if (Math.abs(s - lastScale) > 1e-9) { lastScale = s; opts?.onScale?.(s); }
  };
  const rectOf = () => { const r = svg.getBoundingClientRect(); return r && r.width ? r : ({ left: 0, top: 0, width: base.w, height: base.h } as DOMRect); };

  const clampPan = () => {
    cur.x = Math.max(base.x, Math.min(base.x + base.w - cur.w, cur.x));
    cur.y = Math.max(base.y, Math.min(base.y + base.h - cur.h, cur.y));
  };
  // scale = base.w / cur.w target; keep the user-space point (ux,uy) fixed on screen
  const setScale = (scale: number, ux: number, uy: number) => {
    scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
    const nw = base.w / scale, nh = base.h / scale;
    const rx = (ux - cur.x) / cur.w, ry = (uy - cur.y) / cur.h;
    cur = { x: ux - rx * nw, y: uy - ry * nh, w: nw, h: nh };
    clampPan(); apply();
  };
  const userAt = (clientX: number, clientY: number) => {
    const r = rectOf();
    return { ux: cur.x + ((clientX - r.left) / r.width) * cur.w, uy: cur.y + ((clientY - r.top) / r.height) * cur.h };
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const { ux, uy } = userAt(e.clientX, e.clientY);
    setScale((base.w / cur.w) * Math.pow(1.0015, -e.deltaY), ux, uy);
  };

  // NOTE: we do NOT use svg.setPointerCapture — in Chrome capturing the pointer on the svg
  // retargets the follow-up `click` to the svg, which breaks the world-map marker drilldown
  // (the click's target loses its data-city). Instead we track the drag on `window` and judge
  // drag-vs-click by straight-line distance from the press point (a tiny jitter is still a click).
  let dragging = false, startX = 0, startY = 0, lastX = 0, lastY = 0, wasDrag = false;
  const onWindowMove = (e: PointerEvent) => {
    if (!dragging) return;
    const r = rectOf();
    const dx = e.clientX - lastX, dy = e.clientY - lastY; lastX = e.clientX; lastY = e.clientY;
    if (Math.hypot(e.clientX - startX, e.clientY - startY) > DRAG_PX) wasDrag = true;
    cur.x -= (dx * cur.w) / r.width; cur.y -= (dy * cur.h) / r.height; clampPan(); apply();
  };
  const endDrag = () => {
    if (!dragging) return;
    dragging = false; svg.style.cursor = "grab";
    window.removeEventListener("pointermove", onWindowMove);
    window.removeEventListener("pointerup", endDrag);
    window.removeEventListener("pointercancel", endDrag);
  };
  // Two fingers. A phone had no way into this map but the `+` button, and that button with its
  // two neighbours covered 19% of a 321px-wide map — so the gesture a phone already makes has to
  // do the work instead. Tracked on the svg rather than on `window`: a pinch begins and ends on
  // the drawing, and the drag's window listeners are for a gesture that can leave it.
  //
  // ⚠ `touch-action` stays `pan-y` at base scale (see syncTouchAction): the page must still scroll
  // when a finger drags the map, because on a phone the map is 225px of an 812px page. A pinch is
  // not a behaviour `pan-y` permits the browser to take, so both pointers reach us.
  // built here rather than beside its buttons: `onUp` has to be able to reach it (see the cancel
  // note there), and the buttons below need `setScale`, which needs the state above.
  const ctrls = document.createElement("div");
  ctrls.className = "map-zoom-controls";
  const active = new Map<number, { x: number; y: number }>();
  let pinch: { dist: number; scale: number; ux: number; uy: number } | null = null;
  const spread = (): number => {
    const [a, b] = [...active.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  const startPinch = () => {
    const [a, b] = [...active.values()];
    const { ux, uy } = userAt((a.x + b.x) / 2, (a.y + b.y) / 2);
    pinch = { dist: Math.max(spread(), 1), scale: base.w / cur.w, ux, uy };
    endDrag();        // a pinch is not a pan; drop the one-finger gesture it grew out of
    wasDrag = true;   // ...and it must not land as a click on a city marker either
  };
  const onSvgMove = (e: PointerEvent) => {
    const p = active.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX; p.y = e.clientY;
    if (!pinch || active.size < 2) return;
    e.preventDefault();
    setScale(pinch.scale * (spread() / pinch.dist), pinch.ux, pinch.uy);
  };
  const onUp = (e: PointerEvent) => {
    // ⚠ The one thing no test on this machine can settle: whether a given phone delivers two
    // pointers through `touch-action: pan-y`. It does not have to be settled — when the browser
    // TAKES a gesture it says so, by cancelling the pointers. If that happens with two fingers
    // down, pinch is not available here and the buttons a narrow window hid come back.
    // (A ONE-finger cancel is the normal `pan-y` scroll and says nothing about two.)
    if (e.type === "pointercancel" && active.size >= 2) ctrls.classList.add("pinch-unavailable");
    active.delete(e.pointerId);
    // One finger left of a pinch must not carry on as a drag: the map would leap under it.
    if (active.size < 2) pinch = null;
  };
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    active.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (active.size === 2) { startPinch(); return; }
    if (active.size > 2) return;
    dragging = true; wasDrag = false; startX = lastX = e.clientX; startY = lastY = e.clientY;
    svg.style.cursor = "grabbing";
    window.addEventListener("pointermove", onWindowMove);
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
  };
  // capture-phase: swallow the click that a drag would otherwise turn into a drilldown
  const onClickCapture = (e: MouseEvent) => { if (wasDrag) { e.stopPropagation(); e.preventDefault(); wasDrag = false; } };

  svg.addEventListener("wheel", onWheel, { passive: false });
  svg.addEventListener("pointerdown", onDown);
  svg.addEventListener("pointermove", onSvgMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
  svg.addEventListener("click", onClickCapture, true);
  svg.style.cursor = "grab";

  // restore a saved box (the play map is rebuilt every render): in-range boxes are copied
  // verbatim so a save/restore round-trip is exact; out-of-range scales clamp; garbage is ignored
  const r = opts?.restore ? parse(opts.restore) : null;
  if (r && [r.x, r.y, r.w, r.h].every(Number.isFinite) && r.w > 0 && r.h > 0) {
    const scale = base.w / r.w;
    if (scale >= MIN_SCALE && scale <= MAX_SCALE) {
      const expectH = r.w * (base.h / base.w);
      // legit saves keep their exact bytes (round-trip guarantee); distorted heights are re-derived
      cur = { x: r.x, y: r.y, w: r.w, h: Math.abs(r.h - expectH) <= expectH * 1e-6 ? r.h : expectH };
    } else {
      const s = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
      cur = { x: r.x, y: r.y, w: base.w / s, h: base.h / s };
    }
    clampPan();
  }
  apply(); // normalizes the attribute and sets the initial touch-action either way


  // Named, because a narrow window hides two of the three: with pinch working, `+` and `−` are a
  // desktop's way of doing what two fingers already do, and the three of them covered 19% of the
  // map on a phone. The reset stays — a pinch can leave you somewhere you cannot pinch back from.
  const mkBtn = (cls: string, label: string, fn: () => void) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = cls; b.textContent = label;
    b.addEventListener("click", fn);
    return b;
  };
  const zoomCentre = (factor: number) => setScale((base.w / cur.w) * factor, cur.x + cur.w / 2, cur.y + cur.h / 2);
  const reset = () => { cur = { ...base }; apply(); };
  ctrls.append(mkBtn("zoom-in", "+", () => zoomCentre(1.4)),
               mkBtn("zoom-out", "−", () => zoomCentre(1 / 1.4)),
               mkBtn("zoom-reset", "⤡", reset));
  container.appendChild(ctrls);

  return {
    reset,
    viewBox() { return `${cur.x} ${cur.y} ${cur.w} ${cur.h}`; },
    scale() { return base.w / cur.w; },
    destroy() {
      endDrag(); // tear down any in-progress drag's window listeners
      active.clear(); pinch = null;
      svg.removeEventListener("pointermove", onSvgMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      svg.removeEventListener("wheel", onWheel);
      svg.removeEventListener("pointerdown", onDown);
      svg.removeEventListener("click", onClickCapture, true);
      ctrls.remove();
    },
  };
}
