// viewBox-based zoom/pan for an SVG map (world or city). Simple visual zoom — markers/labels
// scale with the map. No dependencies. Read/write the viewBox as an attribute string (jsdom
// does not implement svg.viewBox.baseVal).
export interface ZoomPan { reset(): void; destroy(): void; }

const MIN_SCALE = 1, MAX_SCALE = 8, DRAG_PX = 4;

export function attachZoomPan(svg: SVGSVGElement, container: HTMLElement): ZoomPan {
  const parse = (s: string | null) => { const a = (s || "0 0 100 100").split(/[\s,]+/).map(Number); return { x: a[0], y: a[1], w: a[2], h: a[3] }; };
  const base = parse(svg.getAttribute("viewBox"));
  let cur = { ...base };
  const apply = () => svg.setAttribute("viewBox", `${cur.x} ${cur.y} ${cur.w} ${cur.h}`);
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

  let dragging = false, moved = 0, lastX = 0, lastY = 0, wasDrag = false;
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    dragging = true; moved = 0; wasDrag = false; lastX = e.clientX; lastY = e.clientY;
    svg.setPointerCapture?.(e.pointerId); svg.style.cursor = "grabbing";
  };
  const onMove = (e: PointerEvent) => {
    if (!dragging) return;
    const r = rectOf();
    const dx = e.clientX - lastX, dy = e.clientY - lastY; lastX = e.clientX; lastY = e.clientY;
    moved += Math.abs(dx) + Math.abs(dy);
    if (moved > DRAG_PX) wasDrag = true;
    cur.x -= (dx * cur.w) / r.width; cur.y -= (dy * cur.h) / r.height; clampPan(); apply();
  };
  const onUp = (e: PointerEvent) => { if (!dragging) return; dragging = false; svg.releasePointerCapture?.(e.pointerId); svg.style.cursor = "grab"; };
  // capture-phase: swallow the click that a drag would otherwise turn into a drilldown
  const onClickCapture = (e: MouseEvent) => { if (wasDrag) { e.stopPropagation(); e.preventDefault(); wasDrag = false; } };

  svg.addEventListener("wheel", onWheel, { passive: false });
  svg.addEventListener("pointerdown", onDown);
  svg.addEventListener("pointermove", onMove);
  svg.addEventListener("pointerup", onUp);
  svg.addEventListener("pointercancel", onUp);
  svg.addEventListener("click", onClickCapture, true);
  svg.style.cursor = "grab";
  svg.style.touchAction = "none";

  const ctrls = document.createElement("div");
  ctrls.className = "map-zoom-controls";
  const mkBtn = (label: string, fn: () => void) => { const b = document.createElement("button"); b.type = "button"; b.textContent = label; b.addEventListener("click", fn); return b; };
  const zoomCentre = (factor: number) => setScale((base.w / cur.w) * factor, cur.x + cur.w / 2, cur.y + cur.h / 2);
  const reset = () => { cur = { ...base }; apply(); };
  ctrls.append(mkBtn("+", () => zoomCentre(1.4)), mkBtn("−", () => zoomCentre(1 / 1.4)), mkBtn("⤡", reset));
  container.appendChild(ctrls);

  return {
    reset,
    destroy() {
      svg.removeEventListener("wheel", onWheel);
      svg.removeEventListener("pointerdown", onDown);
      svg.removeEventListener("pointermove", onMove);
      svg.removeEventListener("pointerup", onUp);
      svg.removeEventListener("pointercancel", onUp);
      svg.removeEventListener("click", onClickCapture, true);
      ctrls.remove();
    },
  };
}
