import type { World } from "../types/world";
import type { CityLayout } from "../engine/city";

export const SVG_NS = "http://www.w3.org/2000/svg";

export function svgEl(tag: string, attrs?: Record<string, string | number>): SVGElement {
  const e = document.createElementNS(SVG_NS, tag);
  if (attrs) for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  return e;
}

export interface Renderer {
  renderWorld(world: World): SVGSVGElement;
  renderCity(layout: CityLayout): SVGSVGElement;
}
