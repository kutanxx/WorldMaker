// The map in one ink on white paper, for print.
//
// A novelist's map goes to a printer in black ink, and the colour map tells its kinds of ground apart by
// colour alone — in one ink every one of them is the same white. The reader chose, from a preview drawn
// on world 1, the illustrated way over plain line work: water lines round the coast, shaded peaks along
// the ranges, hills, trees in the forests (broadleaf, conifer, palm), tufts on the marshes, dots on the
// deserts; and white paper over cream, since a book's paper brings its own tint.
//
// It is drawn FROM the colour map: `renderWorld` draws the map as it always does and, for ink, hands it
// here to be re-inked, so the two can never disagree about where anything is. The marks are placed by a
// hash of their cell rather than a random stream: the same world is the same ink map, and drawing it
// moves nothing in the world.
import type { World } from "../types/world";
import { biomeName, t, type Lang } from "./i18n";
import { svgEl, legendPanel, legendRow, LEGEND_ROW, LEGEND_SWATCH, LEGEND_GAP, LEGEND_TEXT, LEGEND_TITLE_H, LEGEND_W_FIXED } from "./renderer";
import { displayBiomes } from "./displayBiome";
import { settlementKeyRows } from "./settlementKey";
import { ALPINE, TAIGA, TEMPERATE_FOREST, TROPICAL, WETLAND, DESERT } from "../engine/biome";
import { OCEAN } from "../engine/terrain";
import { pointInPolygon, type Point } from "../engine/geometry";
import { type Page, PAGE_MARGIN, cellHash, onPage, spreadInCell } from "./regionPage";

export const INK = "#1b1612";
export const PAPER = "#ffffff";

// The water lines round the coast — how far out each runs and how heavy it is, outermost first. Each is
// lighter than the one inside it, and all of them lighter than the coast: the draughtsman's rule.
const WATER_LINES: [number, number][] = [[11, 0.4], [7.5, 0.5], [4, 0.65]];
const COAST_W = 1.5;
// how many trees a forest's cell carries (a rain forest more), and a desert's dots
const TREES = new Map<number, number>([[TEMPERATE_FOREST, 2], [TAIGA, 2], [TROPICAL, 3]]);
const DUNE_DOTS = 3;
// hills: ground this far below the mountains' line and up to it
const HILL_BAND = 0.07;
// A realm's border in ink: heavy and dashed, on a band of paper this much wider so it reads through the
// trees it crosses.
const BORDER_W = 1.6, BORDER_DASH = "6 2 1.5 2", HALO_EXTRA = 2.2;

const f1 = (v: number) => v.toFixed(1);
const f2 = (v: number) => v.toFixed(2);
const hash = cellHash;

type Kind = "peak" | "hill" | "broadleaf" | "conifer" | "palm" | "marsh" | "dune";

// One mark, standing on (x, y) — the foot of a peak or a tree, the middle of a tuft or a dot. `s` draws it
// at that share of its size, for a region's page (regionPage.ts), finer-grained there since it is smaller.
function mark(kind: Kind, x: number, y: number, w = 12, s = 1): SVGElement {
  const f = s === 1 ? f1 : f2;
  const stroke = { stroke: INK, "stroke-linejoin": "round", "stroke-linecap": "round" };
  if (kind === "peak") {
    const W = w * s, ht = W * 0.78, g = svgEl("g", { class: "ink-peak" });
    g.appendChild(svgEl("path", { d: `M${f(x - W / 2)},${f(y)}L${f(x)},${f(y - ht)}L${f(x + W / 2)},${f(y)}Z`, fill: PAPER }));
    // the shadowed flank: solid ink, a narrow light edge left along the ridge (the Tolkien peak)
    g.appendChild(svgEl("path", { d: `M${f(x)},${f(y - ht)}L${f(x + W / 2)},${f(y)}L${f(x + W * 0.1)},${f(y)}Z`, fill: INK }));
    g.appendChild(svgEl("path", { d: `M${f(x - W / 2)},${f(y)}L${f(x)},${f(y - ht)}L${f(x + W / 2)},${f(y)}`, fill: "none", ...stroke, "stroke-width": 0.9 * s }));
    return g;
  }
  if (kind === "hill") return svgEl("path", { class: "ink-hill", d: `M${f(x - 4 * s)},${f(y)}Q${f(x)},${f(y - 4.2 * s)} ${f(x + 4 * s)},${f(y)}`, fill: PAPER, ...stroke, "stroke-width": 0.6 * s });
  if (kind === "marsh") {
    return svgEl("path", {
      class: "ink-marsh", fill: "none", ...stroke, "stroke-width": 0.5 * s,
      d: `M${f(x - 3 * s)},${f(y)}L${f(x + 3 * s)},${f(y)}M${f(x - 1.6 * s)},${f(y)}L${f(x - 2.3 * s)},${f(y - 2 * s)}M${f(x)},${f(y)}L${f(x)},${f(y - 2.8 * s)}M${f(x + 1.6 * s)},${f(y)}L${f(x + 2.3 * s)},${f(y - 2 * s)}`,
    });
  }
  if (kind === "dune") return svgEl("circle", { class: "ink-dune", cx: f(x), cy: f(y), r: 0.45 * s, fill: INK });
  const g = svgEl("g", { class: `ink-tree ink-${kind}` });
  if (kind === "conifer") {
    g.appendChild(svgEl("path", { d: `M${f(x)},${f(y - 7.3 * s)}L${f(x - 2.4 * s)},${f(y - 1 * s)}L${f(x + 2.4 * s)},${f(y - 1 * s)}Z`, fill: PAPER, ...stroke, "stroke-width": 0.5 * s }));
  } else if (kind === "broadleaf") {
    g.appendChild(svgEl("ellipse", { cx: f(x), cy: f(y - 4.1 * s), rx: 2.4 * s, ry: 3.1 * s, fill: PAPER, ...stroke, "stroke-width": 0.5 * s }));
  } else {
    // a palm: a leaning trunk and its fronds
    const P = (dx: number, dy: number) => `${f(x + dx * s)},${f(y + dy * s)}`;
    g.appendChild(svgEl("path", {
      fill: "none", ...stroke, "stroke-width": 0.5 * s,
      d: `M${P(0, 0)}Q${P(1.1, -2.6)} ${P(0.6, -5.4)}M${P(0.6, -5.4)}L${P(-2.2, -4.4)}M${P(0.6, -5.4)}L${P(-1.6, -6.9)}M${P(0.6, -5.4)}L${P(0.8, -7.6)}M${P(0.6, -5.4)}L${P(3, -6.6)}M${P(0.6, -5.4)}L${P(3.3, -4.2)}`,
    }));
    return g;
  }
  g.appendChild(svgEl("path", { d: `M${f(x)},${f(y - 1 * s)}L${f(x)},${f(y)}`, ...stroke, "stroke-width": 0.5 * s }));
  return g;
}

/**
 * The ground's marks, back (north) to front: a peak on every mountain cell, sized by its height; a hill
 * on open high ground under the mountains; trees on a forest's cells, a tuft on a marsh's, dots on a
 * desert's. Each stands inside its own cell — a point off the cell's middle by a hash of the cell,
 * drawn back toward the middle until it is inside — so none stands out over the sea.
 */
export function inkMarks(world: World, page?: Page): SVGGElement {
  const g = world.grid;
  const shown = displayBiomes(g, world.biome);
  const hillFrom = world.params.mountainLevel - HILL_BAND;
  const placed: { y: number; x: number; el: SVGElement }[] = [];
  const dense = page && page.z > 1 ? page : null;
  for (let i = 0; i < g.count; i++) {
    if (world.terrain[i] === OCEAN) continue;
    const poly = g.polygons[i] as Point[];
    const cx = g.points[i * 2], cy = g.points[i * 2 + 1];
    if (dense) {
      // A region's page (regionPage.ts): as thick on the page as the whole map has them — z^2 to a cell,
      // 1/z the size, each keeping its page's room from the next — for the cells on the page only.
      if (!onPage(dense, cx, cy, PAGE_MARGIN)) continue;
      const s = 1 / dense.z, times = dense.z * dense.z;
      const scatter = (kind: Kind, n: number, gap: number, salt: number, w?: number) => {
        for (const [x, y] of spreadInCell(poly, i, Math.round(n * times), gap * s, salt)) {
          const el = mark(kind, x, y, w, s);
          el.setAttribute("data-cell", String(i));
          el.setAttribute("data-x", f2(x)); el.setAttribute("data-y", f2(y));
          placed.push({ y, x, el });
        }
      };
      const b = shown[i], h = world.heights[i];
      const trees = TREES.get(b);
      if (b === ALPINE) scatter("peak", 1, 7, 1000, 10 + 5 * Math.min(1, Math.max(0, (h - world.params.mountainLevel) / 0.4)));
      else if (trees) scatter(b === TAIGA ? "conifer" : b === TROPICAL ? "palm" : "broadleaf", trees, b === TROPICAL ? 4 : 4.2, 2000);
      else if (b === WETLAND) scatter("marsh", 1, 6, 3000);
      else if (b === DESERT) scatter("dune", DUNE_DOTS, 2.5, 4000);
      else if (h >= hillFrom) scatter("hill", 1, 7, 5000);
      continue;
    }
    // (to the tenth of a unit it is drawn at, and tested there: a point inside that rounds outside is not)
    const at = (k: number, spread: number): Point => {
      let dx = (hash(i, k) - 0.5) * spread, dy = (hash(i, k + 97) - 0.5) * spread;
      for (let n = 0; n < 5; n++, dx /= 2, dy /= 2) {
        const p: Point = [Number(f1(cx + dx)), Number(f1(cy + dy))];
        if (pointInPolygon(p, poly)) return p;
      }
      return [cx, cy];
    };
    const put = (kind: Kind, [x, y]: Point, w?: number) => {
      const el = mark(kind, x, y, w);
      el.setAttribute("data-cell", String(i));
      el.setAttribute("data-x", String(x)); el.setAttribute("data-y", String(y));
      placed.push({ y, x, el });
    };
    const b = shown[i], h = world.heights[i];
    const trees = TREES.get(b);
    if (b === ALPINE) put("peak", at(1, 4), 10 + 5 * Math.min(1, Math.max(0, (h - world.params.mountainLevel) / 0.4)));
    else if (trees) for (let k = 0; k < trees; k++) put(b === TAIGA ? "conifer" : b === TROPICAL ? "palm" : "broadleaf", at(10 + k, 10));
    else if (b === WETLAND) put("marsh", at(30, 8));
    else if (b === DESERT) for (let k = 0; k < DUNE_DOTS; k++) put("dune", at(50 + k, 10));
    else if (h >= hillFrom) put("hill", at(2, 5));
  }
  placed.sort((a, b) => a.y - b.y || a.x - b.x);
  const layer = svgEl("g", { class: "ink-marks" }) as SVGGElement;
  for (const p of placed) layer.appendChild(p.el);
  return layer;
}

// A key for the ink map: the marks it draws, drawn as it draws them, its road and sea route — and the marks
// over them all, the capitals, the towns and the free ports, drawn in colour here and inked by `twoInks` as
// the map's own are.
function inkKey(marks: SVGGElement, lang: Lang, height: number, road: boolean, sea: boolean, freePorts: boolean): SVGGElement {
  const has = (cls: string) => marks.querySelector(`.${cls}`) !== null;
  const rows: [string, (x: number, y: number) => SVGElement[]][] = [];
  const two = (kind: Kind) => (x: number, y: number) => [mark(kind, x + 3.2, y + 1.5), mark(kind, x + 8.8, y + 1.5)];
  if (has("ink-peak")) rows.push([biomeName(lang, ALPINE), (x, y) => [mark("peak", x + 6, y + 1.5, 10)]]);
  if (has("ink-hill")) rows.push([t(lang, "keyHills"), (x, y) => [mark("hill", x + 6, y)]]);
  if (has("ink-broadleaf")) rows.push([biomeName(lang, TEMPERATE_FOREST), two("broadleaf")]);
  if (has("ink-conifer")) rows.push([biomeName(lang, TAIGA), two("conifer")]);
  if (has("ink-palm")) rows.push([biomeName(lang, TROPICAL), two("palm")]);
  if (has("ink-marsh")) rows.push([biomeName(lang, WETLAND), (x, y) => [mark("marsh", x + 6, y - 1)]]);
  if (has("ink-dune")) rows.push([biomeName(lang, DESERT), (x, y) => [mark("dune", x + 2.5, y - 4), mark("dune", x + 6.5, y - 2.5), mark("dune", x + 10, y - 5)]]);
  if (road) rows.push([t(lang, "keyRoad"), (x, y) => [
    svgEl("line", { x1: x, y1: y - 3, x2: x + 12, y2: y - 3, stroke: PAPER, "stroke-width": 2.3, "stroke-linecap": "round" }),
    svgEl("line", { x1: x, y1: y - 3, x2: x + 12, y2: y - 3, stroke: INK, "stroke-width": 0.9, "stroke-dasharray": "4 1.6" }),
  ]]);
  if (sea) rows.push([t(lang, "keySeaRoute"), (x, y) => [svgEl("line", { x1: x, y1: y - 3, x2: x + 12, y2: y - 3, stroke: INK, "stroke-width": 0.9, "stroke-dasharray": "1.2 2.4", "stroke-linecap": "round" })]]);
  for (const [word, mark] of settlementKeyRows(lang, freePorts)) rows.push([word, (x, y) => [mark(x, y)]]);
  const legend = svgEl("g", { class: "legend biome-legend ink-legend" }) as SVGGElement;
  const x0 = 14, y0 = height - 14 - rows.length * LEGEND_ROW;
  legend.appendChild(legendPanel(x0 - 5, y0 - 10 - LEGEND_TITLE_H, LEGEND_W_FIXED, rows.length * LEGEND_ROW + 14 + LEGEND_TITLE_H, t(lang, "legendTerrain")));
  rows.forEach(([word, draw], k) => {
    const y = y0 + k * LEGEND_ROW;
    const row = legendRow(LEGEND_ROW);
    for (const el of draw(x0, y)) { el.classList.add("legend-symbol"); row.appendChild(el); }
    const text = svgEl("text", { x: x0 + LEGEND_SWATCH + LEGEND_GAP, y, "font-size": LEGEND_TEXT, fill: INK, "letter-spacing": 0.3 });
    text.textContent = word;
    row.appendChild(text);
    legend.appendChild(row);
  });
  return legend;
}

// Anything still in a colour after the passes above takes the nearer of the two inks by its lightness —
// the frame, the compass, the cartouche, and whatever a later layer adds without knowing about ink.
function twoInks(root: Element): void {
  const lightness = (c: string): number | null => {
    const v = c.trim().toLowerCase();
    if (v === "white") return 1;
    if (v === "black") return 0;
    let m = /^#([0-9a-f]{3})$/.exec(v);
    const hex = m ? m[1].split("").map((d) => d + d).join("") : (/^#([0-9a-f]{6})$/.exec(v) ?? [])[1];
    if (hex) return (0.2126 * parseInt(hex.slice(0, 2), 16) + 0.7152 * parseInt(hex.slice(2, 4), 16) + 0.0722 * parseInt(hex.slice(4, 6), 16)) / 255;
    m = /^rgba?\(([^)]+)\)$/.exec(v);
    if (m) { const [r, g, b] = m[1].split(",").map(Number); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; }
    return null;
  };
  for (const el of [root, ...root.querySelectorAll("*")]) {
    for (const a of ["fill", "stroke", "stop-color"]) {
      const v = el.getAttribute(a);
      if (v === null || v === "none" || v === "transparent" || v === INK || v === PAPER) continue;
      const l = lightness(v);
      if (l !== null) el.setAttribute(a, l > 0.55 ? PAPER : INK);
    }
  }
}

/** A piece drawn in colour after the map was inked (a town's new mark for another year), put into the two inks. */
export function reInk(el: Element): void {
  for (const text of [el, ...el.querySelectorAll("*")].filter((e) => e.tagName.toLowerCase() === "text")) {
    text.setAttribute("fill", INK);
    if (text.getAttribute("stroke")) text.setAttribute("stroke", PAPER);
  }
  twoInks(el);
}

/**
 * The overlay slot in ink — the realms', the peoples' or the provinces' layer for a year: no fills, its
 * borders heavy and dashed on a band of paper, its names in ink, and no key of colours it no longer has.
 * The page refills the slot at every year, and calls this after it as `renderWorld` does.
 */
export function inkSlot(slot: Element): void {
  for (const p of slot.querySelectorAll(".territory, .culture-area, .province-fill")) { p.setAttribute("fill", "none"); p.removeAttribute("fill-opacity"); }
  for (const l of slot.querySelectorAll(".nation-legend, .culture-legend")) l.remove();
  for (const p of slot.querySelectorAll(".province-border")) { p.setAttribute("stroke", INK); p.setAttribute("stroke-width", "0.6"); p.setAttribute("stroke-dasharray", "1 1.6"); }
  for (const p of slot.querySelectorAll(".border, .nation-border, .culture-border")) {
    p.setAttribute("stroke", INK);
    p.setAttribute("stroke-width", String(BORDER_W));
    p.setAttribute("stroke-dasharray", BORDER_DASH);
    const halo = p.cloneNode(false) as Element;
    halo.setAttribute("class", "ink-border-halo");
    halo.setAttribute("stroke", PAPER);
    halo.setAttribute("stroke-width", String(BORDER_W + HALO_EXTRA));
    halo.removeAttribute("stroke-dasharray");
    p.before(halo);
  }
  for (const text of slot.querySelectorAll("text")) { text.setAttribute("fill", INK); if (text.getAttribute("stroke")) text.setAttribute("stroke", PAPER); }
  twoInks(slot);
}

/**
 * The map drawn `k` times over, for print. Its marks, water lines and names are drawn in map units and
 * grow with it; the lines pinned to the screen (`vector-effect: non-scaling-stroke` — the coast, the
 * rivers, the roads, the borders) would stay as thin as they are on a screen, and are thickened by as
 * much. For a file only: a map on the screen keeps its lines pinned.
 */
export function forPrint(svg: SVGSVGElement, k: number): void {
  for (const el of svg.querySelectorAll("[vector-effect='non-scaling-stroke'][stroke-width]")) {
    el.setAttribute("stroke-width", String(Number(el.getAttribute("stroke-width")) * k));
  }
}

/** The world map as `renderWorld` drew it, re-inked for print (see the head of this file). */
export function inkWorld(svg: SVGSVGElement, world: World, lang: Lang, page?: Page): void {
  svg.classList.add("ink");
  const ground = svg.querySelector(":scope > rect");
  ground?.setAttribute("fill", PAPER);
  const coast = svg.querySelector(".coastline");
  const coastD = coast?.getAttribute("d") ?? "";
  const waterlines = svg.querySelector(".waterlines");
  if (waterlines) {
    // each line a band of ink with the paper drawn back over its middle, under the land, so only the
    // seaward half of every ring shows
    waterlines.replaceChildren();
    const ring = (stroke: string, width: number) => svgEl("path", { d: coastD, fill: "none", stroke, "stroke-width": width, "stroke-linecap": "round", "stroke-linejoin": "round" });
    for (const [r, w] of WATER_LINES) waterlines.append(ring(INK, 2 * r + w), ring(PAPER, 2 * r - w));
  }
  const biomes = svg.querySelector(".biomes");
  if (biomes) { biomes.removeAttribute("opacity"); for (const p of biomes.children) p.setAttribute("fill", PAPER); }
  svg.querySelector(".relief-shade")?.remove();
  svg.querySelector(".reliefs")?.remove();
  const marks = inkMarks(world, page);
  (biomes ?? ground)?.after(marks);
  if (coast) { coast.setAttribute("stroke", INK); coast.setAttribute("stroke-width", String(COAST_W)); }
  const slot = svg.querySelector(".political-slot");
  if (slot) inkSlot(slot);
  for (const p of svg.querySelectorAll(".river")) { p.setAttribute("stroke", INK); p.setAttribute("stroke-width", f1(Number(p.getAttribute("stroke-width")) * 0.7)); }
  for (const p of svg.querySelectorAll(".sea-route")) { p.setAttribute("stroke", INK); p.setAttribute("stroke-width", "0.9"); p.setAttribute("stroke-dasharray", "1.2 2.4"); }
  for (const p of svg.querySelectorAll(".road-casing")) p.setAttribute("stroke", PAPER);
  for (const p of svg.querySelectorAll(".road")) { p.setAttribute("stroke", INK); p.setAttribute("stroke-width", "0.9"); p.setAttribute("stroke-dasharray", "4 1.6"); }
  for (const text of svg.querySelectorAll("text")) { text.setAttribute("fill", INK); if (text.getAttribute("stroke")) text.setAttribute("stroke", PAPER); }
  const key = svg.querySelector(":scope > .biome-legend");
  if (key) key.replaceWith(inkKey(marks, lang, world.grid.height, world.roads.length > 0, (world.seaRoutes?.length ?? 0) > 0, svg.querySelector(".econ-zones") !== null));
  twoInks(svg);
}
