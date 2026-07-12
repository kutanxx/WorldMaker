// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { attachZoomPan } from "./zoomPan";

// jsdom does not implement PointerEvent (only MouseEvent) — polyfill the small
// subset of properties this test dispatches (button/clientX/clientY/pointerId).
if (typeof (globalThis as any).PointerEvent === "undefined") {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number;
    constructor(type: string, params: MouseEventInit & { pointerId?: number } = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 0;
    }
  }
  (globalThis as any).PointerEvent = PointerEventPolyfill;
}

const SVGNS = "http://www.w3.org/2000/svg";
function makeSvg(): { svg: SVGSVGElement; container: HTMLElement } {
  const container = document.createElement("div");
  const svg = document.createElementNS(SVGNS, "svg") as SVGSVGElement;
  svg.setAttribute("viewBox", "0 0 100 100");
  // jsdom returns a 0-size rect; stub a known box so client→user math works
  svg.getBoundingClientRect = () => ({ left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100, x: 0, y: 0, toJSON() {} }) as DOMRect;
  container.appendChild(svg);
  document.body.appendChild(container);
  return { svg, container };
}
const vb = (svg: SVGSVGElement) => (svg.getAttribute("viewBox") || "").split(/\s+/).map(Number);

describe("attachZoomPan", () => {
  let svg: SVGSVGElement, container: HTMLElement;
  beforeEach(() => { document.body.innerHTML = ""; ({ svg, container } = makeSvg()); });

  it("wheel-up zooms in (viewBox shrinks) toward the cursor, clamped at 8x", () => {
    const zp = attachZoomPan(svg, container);
    svg.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, clientX: 50, clientY: 50, cancelable: true }));
    let [, , w] = vb(svg);
    expect(w).toBeLessThan(100);
    for (let i = 0; i < 60; i++) svg.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, clientX: 50, clientY: 50, cancelable: true }));
    [, , w] = vb(svg);
    expect(w).toBeGreaterThanOrEqual(100 / 8 - 1e-6); // scale capped at 8 → w ≥ 12.5
    zp.destroy();
  });

  it("wheel-down never zooms out past the base (scale floor 1)", () => {
    const zp = attachZoomPan(svg, container);
    for (let i = 0; i < 10; i++) svg.dispatchEvent(new WheelEvent("wheel", { deltaY: 100, clientX: 50, clientY: 50, cancelable: true }));
    expect(vb(svg)).toEqual([0, 0, 100, 100]);
    zp.destroy();
  });

  it("drag pans when zoomed, clamped inside the base extent", () => {
    const zp = attachZoomPan(svg, container);
    svg.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, clientX: 50, clientY: 50, cancelable: true })); // zoom in first
    const before = vb(svg);
    // pointerdown on the svg starts the drag; move/up are tracked on window (real-browser drag)
    svg.dispatchEvent(new PointerEvent("pointerdown", { button: 0, clientX: 50, clientY: 50, pointerId: 1 }));
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 30, clientY: 50, pointerId: 1 }));
    window.dispatchEvent(new PointerEvent("pointerup", { clientX: 30, clientY: 50, pointerId: 1 }));
    const after = vb(svg);
    expect(after[0]).not.toBe(before[0]); // x panned
    expect(after[0]).toBeGreaterThanOrEqual(0);            // clamped ≥ base.x
    expect(after[0] + after[2]).toBeLessThanOrEqual(100 + 1e-6); // clamped within base
    zp.destroy();
  });

  it("reset restores the base viewBox", () => {
    const zp = attachZoomPan(svg, container);
    svg.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, clientX: 20, clientY: 20, cancelable: true }));
    zp.reset();
    expect(vb(svg)).toEqual([0, 0, 100, 100]);
    zp.destroy();
  });

  it("swallows the click after a drag but lets a genuine click through", () => {
    const zp = attachZoomPan(svg, container);
    const marker = document.createElementNS(SVGNS, "rect");
    marker.setAttribute("data-city", "1");
    svg.appendChild(marker);
    let clicks = 0;
    svg.addEventListener("click", () => { clicks++; }); // app's drilldown handler (bubble)

    // drag (>4px from the press point) then click on the marker → swallowed
    svg.dispatchEvent(new PointerEvent("pointerdown", { button: 0, clientX: 50, clientY: 50, pointerId: 1 }));
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 70, clientY: 50, pointerId: 1 }));
    window.dispatchEvent(new PointerEvent("pointerup", { clientX: 70, clientY: 50, pointerId: 1 }));
    marker.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(clicks).toBe(0);

    // no-drag click on the marker → passes through
    svg.dispatchEvent(new PointerEvent("pointerdown", { button: 0, clientX: 50, clientY: 50, pointerId: 2 }));
    window.dispatchEvent(new PointerEvent("pointerup", { clientX: 50, clientY: 50, pointerId: 2 }));
    marker.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(clicks).toBe(1);
    zp.destroy();
  });

  it("mounts controls and destroy() removes them + stops responding", () => {
    const zp = attachZoomPan(svg, container);
    expect(container.querySelector(".map-zoom-controls")).not.toBeNull();
    zp.destroy();
    expect(container.querySelector(".map-zoom-controls")).toBeNull();
    svg.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, clientX: 50, clientY: 50, cancelable: true }));
    expect(vb(svg)).toEqual([0, 0, 100, 100]); // no longer responds
  });

  it("viewBox() reports the current box and restore round-trips across re-attach", () => {
    const zp = attachZoomPan(svg, container);
    (container.querySelectorAll(".map-zoom-controls button")[0] as HTMLButtonElement).click(); // +
    const saved = zp.viewBox();
    expect(saved).not.toBe("0 0 100 100");
    expect(svg.getAttribute("viewBox")).toBe(saved);
    zp.destroy();
    const fresh = makeSvg();
    const zp2 = attachZoomPan(fresh.svg, fresh.container, { restore: saved });
    expect(zp2.viewBox()).toBe(saved); // exact — an in-range restore copies the numbers verbatim
    expect(fresh.svg.getAttribute("viewBox")).toBe(saved);
    zp2.destroy();
  });

  it("garbage restore starts at base; over-zoomed restore clamps to MAX_SCALE", () => {
    const a = attachZoomPan(svg, container, { restore: "not a box" });
    expect(a.viewBox()).toBe("0 0 100 100");
    a.destroy();
    const fresh = makeSvg();
    const b = attachZoomPan(fresh.svg, fresh.container, { restore: "0 0 1 1" }); // scale 100 → clamp 8
    expect(vb(fresh.svg)[2]).toBeCloseTo(100 / 8, 5);
    b.destroy();
  });

  it("restore rejects an aspect-distorted height (derives h from w)", () => {
    const zp = attachZoomPan(svg, container, { restore: "0 0 50 300" }); // w in range, h nonsense
    expect(vb(svg)).toEqual([0, 0, 50, 50]); // h re-derived from base aspect (100:100)
    zp.destroy();
  });

  it("touch-action follows scale: pan-y at base, none when zoomed, pan-y after reset", () => {
    const zp = attachZoomPan(svg, container);
    expect(svg.style.touchAction).toBe("pan-y");
    (container.querySelectorAll(".map-zoom-controls button")[0] as HTMLButtonElement).click(); // +
    expect(svg.style.touchAction).toBe("none");
    zp.reset();
    expect(svg.style.touchAction).toBe("pan-y");
    zp.destroy();
  });
});
