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
// The room a heading needs above the rows. Callers add it to the panel's height and put the panel
// that much further from the rows, so the swatches do not move.
// A key nobody can read is a key nobody has. Measured on the live page, legend text rendered at
// 8.7-9.2 CSS pixels against a widest label of 28.8 units inside a 104-unit panel — small enough to
// squint at, with three quarters of the panel standing empty. One size for every key on both maps,
// because they were 9 in one place, 8.5 in another and 7 on the city plate.
// The key, in map units. These are DELIBERATELY larger than they look: the world map draws its
// 1000-unit viewBox at about 993 CSS px, so a unit is a pixel — while the city plate draws its 568
// at 883, where a unit is 1.55 pixels. Measured on the live page at 1920x945, that left the plate's
// key 28% larger in type and 25% larger in swatch than the world map's (14.0 CSS px against 10.9,
// 12.4 against 9.9), on the map a reader spends the most time with. These numbers land the world
// key on the plate's rendered size: 14 x 0.993 = 13.9 against the plate's 14.0, and so on.
// ⚠ The plate keeps its own smaller numbers (9 / 7.5 / 11) and is the reference; changing these
// does not touch it.
export const LEGEND_TEXT = 14;
export const LEGEND_TITLE = 12;
// ⚠ USE THIS. It sat here at 15 with the note below and every one of the four legends wrote its own
// `14` instead — which is exactly how the map ended up with a key nobody had measured in one place.
export const LEGEND_ROW = 17;      // was 14: taller type needs the room
export const LEGEND_SWATCH = 12;   // the colour chip, and the width the words are indented past
export const LEGEND_GAP = 9;       // swatch to word
export const LEGEND_TITLE_H = 20; // 15 left the heading 2 units off the first swatch; measured

// How wide the cartouche is, measured rather than guessed. The longest row was taken across seeds
// 1/2/3/7/11 in BOTH languages, from the panel's own left edge: 82.3 units for the fixed keys
// (biomes, and the province key's rules and dot) and 93.4 for the ones that carry generated names
// (realms, peoples), which are capped at ten letters. Plus a right margin matching the 5-unit inset
// on the left, and headroom for a name no seed here happened to produce.
// ⚠ Raising the type first, then measuring, made these SMALLER than they were before it (104/112/
// 120): the old panels carried up to 42 units of empty parchment, and a panel that covers the map
// should not be wider than its own words.
// ⚠ These are set by the GUARD in svgWorldRenderer.test.ts, not by the browser numbers above. That
// test bounds a label at 0.62 em a character because jsdom cannot measure text — generous for Latin
// (the real face measures about 0.48) and NOT generous for Korean, whose glyphs are full-width. The
// browser said 96 and 112 would do for every seed sampled; the guard says 112 and 124 for a label
// neither of us has seen yet, and on this the guard wins.
export const LEGEND_W_FIXED = 112;
export const LEGEND_W_NAMED = 124;

/**
 * The cartouche a legend sits in. `title` names what the swatches are a key TO — every other titled
 * thing on these maps is set in the display face, and the legend was the one panel saying nothing
 * about itself.
 */
export function legendPanel(x: number, y: number, w: number, h: number, title?: string, titleSize = LEGEND_TITLE): SVGElement {
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
  if (title) {
    const t = svgEl("text", {
      class: "legend-title", x: x + 7, y: y + titleSize + 3.5, "font-size": titleSize,
      fill: INK, "letter-spacing": 0.9, "font-family": "Cinzel, serif", "font-weight": 600,
    });
    t.textContent = title;
    g.appendChild(t);
  }
  // How much of the top of this box is the cartouche's own heading. The key is also shown OFF the
  // map, in a panel the page already frames, and there it wants neither this frame nor a second
  // heading — `fitToKey` crops past this band and the stylesheet hides the rest. The number lives
  // here because this is where the heading is placed; anywhere else it would be a guess.
  g.setAttribute("data-band", String(title ? titleSize + 8 : 0));
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
