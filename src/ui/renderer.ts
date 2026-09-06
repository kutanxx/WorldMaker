import type { World } from "../types/world";
import type { CityLayout } from "../engine/city";

export const SVG_NS = "http://www.w3.org/2000/svg";

export function svgEl(tag: string, attrs?: Record<string, string | number>): SVGElement {
  const e = document.createElementNS(SVG_NS, tag);
  if (attrs) for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  return e;
}

// The parchment atlas palette, shared by everything that draws on the map so a panel cannot drift
// into a colour of its own.
export const INK = "#3c2f1c";
export const PARCHMENT = "#f3ead2";

// The enclosure a legend sits in. Every legend on this map — biomes, nations, cultures — used to be
// a rounded white card with a thin tan edge: the one thing on the page that looked like browser UI
// rather than cartography, next to a compass rose and a double-ruled border. Historically the box
// holding a map's key is a cartouche, and the restrained end of that tradition — the plain ruled
// tablet, not Baroque strapwork — is what suits a map whose own frame is already two plain rules and
// four dots. So the panel simply borrows that frame at panel scale: heavy rule, fine rule inside it,
// a dot at each corner, all in the map's own ink.
export function legendPanel(x: number, y: number, w: number, h: number): SVGElement {
  const g = svgEl("g", { class: "legend-panel" });
  const rule = { fill: "none", stroke: INK, "vector-effect": "non-scaling-stroke" };
  g.appendChild(svgEl("rect", {
    x, y, width: w, height: h, ...rule,
    fill: PARCHMENT, "fill-opacity": 0.96, "stroke-width": 1.2,
  }));
  g.appendChild(svgEl("rect", {
    x: x + 3, y: y + 3, width: w - 6, height: h - 6, ...rule, "stroke-width": 0.5,
  }));
  for (const [cx, cy] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) {
    g.appendChild(svgEl("circle", { cx, cy, r: 1.2, fill: INK }));
  }
  return g;
}

// A four-point star, used for the compass needle and for a capital's mark.
export function starPath(cx: number, cy: number, points: number, outer: number, inner: number): string {
  let d = "";
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    d += (i === 0 ? "M" : "L") + (cx + r * Math.cos(a)).toFixed(1) + "," + (cy + r * Math.sin(a)).toFixed(1);
  }
  return d + "Z";
}

// The compass and the frame belong to every map this project draws, not only the world one — a city
// plan with no border and no north is a drawing, where the same plan inside the same ruled frame is
// a plate from the same atlas. They live here so both renderers reach for the one implementation.
export function compassRose(cx: number, cy: number, r: number, north: string): SVGElement {
  const g = svgEl("g", { class: "compass" });
  g.appendChild(svgEl("circle", { cx, cy, r, fill: PARCHMENT, "fill-opacity": 0.55, stroke: INK, "stroke-width": 0.8 }));
  g.appendChild(svgEl("path", { d: starPath(cx, cy, 4, r * 0.92, r * 0.3), fill: INK }));
  const n = svgEl("text", { class: "compass-n", x: cx, y: cy - r - 2, "text-anchor": "middle", "font-size": 7, fill: INK });
  n.textContent = north;
  g.appendChild(n);
  return g;
}

export function mapFrame(w: number, h: number): SVGElement {
  const g = svgEl("g", { class: "map-frame" });
  g.appendChild(svgEl("rect", { x: 4, y: 4, width: w - 8, height: h - 8, fill: "none", stroke: INK, "stroke-width": 2 }));
  g.appendChild(svgEl("rect", { x: 8, y: 8, width: w - 16, height: h - 16, fill: "none", stroke: INK, "stroke-width": 0.6 }));
  for (const [x, y] of [[8, 8], [w - 8, 8], [8, h - 8], [w - 8, h - 8]]) {
    g.appendChild(svgEl("circle", { cx: x, cy: y, r: 2, fill: INK }));
  }
  return g;
}

export interface Renderer {
  renderWorld(world: World): SVGSVGElement;
  renderCity(layout: CityLayout): SVGSVGElement;
}
