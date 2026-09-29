// A region of the map written to its own page (the reader's "보이는 부분" / "Visible area" export).
//
// The page is the whole map's page — the same width, the same type — holding `z` times less of the world:
// the region the reader had zoomed to. Everything the whole map sizes by its page keeps that size, so a
// chapter's map and the world's, printed the same size, read as one set: the names (labelScale.ts
// `applyPageScale`), the room between them (deconflict.ts `room`), the lines already pinned to the screen,
// the key, title, compass and scale bar (carried to the page's corners here), and the glyphs a cell stands
// for — a range's peaks, a forest's trees — which come z^2 as thick at 1/z the size (svgWorldRenderer.ts,
// inkStyle.ts). The reader chose this over the zoomed screen enlarged, from a preview drawn on world 1
// (`.claude/probes/out/region-preview.html`, 2026-09-28).
import { pointInPolygon, type Point } from "../engine/geometry";
import type { World } from "../types/world";
import { svgEl } from "./renderer";
import { scaleBar, KM_PER_UNIT, WORLD_BAR_UNITS, walkCaption } from "./scaleBar";
import type { Lang } from "./i18n";
import { riverNameAt, riverNameSize } from "./riverName";
import { FRAME_PAD } from "./deconflict";

/** The part of the world a page holds (map units), and how many times less of it than the whole map's page. */
export interface Page { x: number; y: number; w: number; h: number; z: number }

// how far past the page's edge a cell may stand and still be drawn for it: a glyph a little over the edge
// is cut there, as the page cuts the land, rather than leaving a bare strip along it
export const PAGE_MARGIN = 20;

/** The page a zoomed map stands at, read off its zoom's viewBox — or null at rest, where the page is the whole map. */
export function pageOf(viewBox: string, mapWidth: number): Page | null {
  const [x, y, w, h] = viewBox.split(/[\s,]+/).map(Number);
  if (![x, y, w, h].every(Number.isFinite) || !(w > 0) || !(h > 0)) return null;
  const z = mapWidth / w;
  return z > 1 + 1e-6 ? { x, y, w, h, z } : null;
}

export const onPage = (p: Page, x: number, y: number, margin = 0): boolean =>
  x >= p.x - margin && x <= p.x + p.w + margin && y >= p.y - margin && y <= p.y + p.h + margin;

/** A number in [0, 1) for cell `i` and slot `k`, the same every time: marks are placed by it, never by a random stream. */
export const cellHash = (i: number, k: number): number => {
  let h = (Math.imul(i + 1, 374761393) + Math.imul(k + 1, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/**
 * Up to `n` points inside cell `cell`'s polygon, each at least `gap` from the others, placed by the cell's
 * hash. `salt` keeps two kinds of mark from choosing the same places. A crowded cell gives fewer than `n`
 * rather than letting two marks stand on each other. Each is to the hundredth of a unit it is drawn at, and
 * tested there: a point inside that rounds outside is not inside.
 */
export function spreadInCell(poly: Point[], cell: number, n: number, gap: number, salt: number): Point[] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of poly) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const at = (v: number) => Number(v.toFixed(2));
  const out: Point[] = [];
  for (let k = 0; out.length < n && k < n * 12; k++) {
    const p: Point = [at(x0 + cellHash(cell, salt + 2 * k) * (x1 - x0)), at(y0 + cellHash(cell, salt + 2 * k + 1) * (y1 - y0))];
    if (!pointInPolygon(p, poly)) continue;
    if (out.some(([qx, qy]) => Math.hypot(qx - p[0], qy - p[1]) < gap)) continue;
    out.push(p);
  }
  return out;
}

// what the whole map stands at its page's edges and corners: its keys (the terrain's, and a view's own in
// its layer), its title, its compass, its scale bar and its frame
const FURNITURE = ":scope > .compass, :scope > .world-name, :scope > .scale-bar, :scope > .map-frame, .legend";
const AREA_NAMES = ".region-label, .nation-label, .province-label, .culture-label";
// a river crossing the page is named again where it crosses, on a run of at least this many of its points
const RIVER_RUN = 3;

const num = (v: number) => String(Number(v.toFixed(2)));
// the round distance for a page's bar: the largest of 1, 2 and 5 times a power of ten within `km`
const roundKm = (km: number) => {
  const p = 10 ** Math.floor(Math.log10(km));
  return [5, 2, 1].map((m) => m * p).find((v) => v <= km)!;
};

/**
 * Set the whole map, as `renderWorld` drew it for `page`, on the region's page: the view is the region, the
 * whole map's furniture stands at the page's edges at its page size, the scale bar is measured again, the
 * water lines keep the whole map's spacing, and only what is on the page is named — a town by its dot, an
 * area by the middle its name stands at, a river where it crosses the page. The names are then sized and
 * culled for the page (exportLabels.ts, with `page.z`).
 */
export function putOnPage(svg: SVGSVGElement, page: Page, world: World, lang: Lang): void {
  const { width, height } = world.grid;
  const k = 1 / page.z;
  const box = [page.x, page.y, page.w, page.h].map(num).join(" ");
  svg.setAttribute("viewBox", box);
  svg.dataset.baseViewbox = box;   // where the cull keeps names inside (deconflict.ts)

  // The furniture, carried as one group: drawn in the whole map's page units and scaled onto the region's,
  // so it stands where it stands on the whole map's page and is as big there. deconflict.ts reads `data-*`.
  const furniture = svgEl("g", {
    class: "page-furniture", transform: `translate(${num(page.x)} ${num(page.y)}) scale(${k.toFixed(5)})`,
    "data-x": num(page.x), "data-y": num(page.y), "data-k": String(k),
  });
  for (const el of [...svg.querySelectorAll(FURNITURE)]) furniture.appendChild(el);
  const old = furniture.querySelector(".scale-bar");
  if (old) {
    const km = roundKm((WORLD_BAR_UNITS * KM_PER_UNIT) / page.z), units = (km / KM_PER_UNIT) * page.z;
    const bar = scaleBar(width / 2 - units / 2, height - 26, units, `${km} km`, walkCaption(km, lang), WORLD_BAR_UNITS);
    // in the inks the whole map's bar was drawn in — an ink map's are black and white
    const was = [old, ...old.querySelectorAll("*")], now = [bar, ...bar.querySelectorAll("*")];
    now.forEach((e, i) => { for (const a of ["fill", "stroke"]) { const v = was[i]?.getAttribute(a); if (v !== null && v !== undefined) e.setAttribute(a, v); } });
    old.replaceWith(bar);
  }
  svg.appendChild(furniture);

  for (const p of svg.querySelectorAll(".waterlines path")) {
    p.setAttribute("stroke-width", num(Number(p.getAttribute("stroke-width")) * k));
  }

  // names: what is not on the page is not named on it
  const cities = new Map(world.cities.map((c) => [String(c.id), c]));
  for (const el of [...svg.querySelectorAll(".city-label")]) {
    const c = cities.get(el.getAttribute("data-city") ?? "");
    if (!c || !onPage(page, c.x, c.y)) el.remove();
  }
  for (const el of [...svg.querySelectorAll(AREA_NAMES)]) {
    if (!onPage(page, Number(el.getAttribute("x")), Number(el.getAttribute("y")))) el.remove();
  }
  for (const el of [...svg.querySelectorAll(".river-label")]) {
    const river = world.rivers[Number((el.getAttribute("data-name") ?? "").slice(1))];
    if (!river) { el.remove(); continue; }
    const middle = river.path[Math.floor(river.path.length / 2)];
    if (onPage(page, middle[0], middle[1])) continue;
    // the longest run of its course on the page, and its name at that run's middle
    const [from, to] = longestRun(page, river.path);
    if (to - from < RIVER_RUN) { el.remove(); continue; }
    const at = riverNameAt(river.path, Math.floor((from + to - 1) / 2), riverNameSize(river.flux));
    el.setAttribute("x", num(at.x));
    el.setAttribute("y", num(at.y));
    el.setAttribute("transform", `rotate(${at.deg.toFixed(1)} ${num(at.x)} ${num(at.y)})`);
  }
}

// the longest run of a course's points on the page, as [first, past the last]
function longestRun(page: Page, path: [number, number][]): [number, number] {
  let best: [number, number] = [0, 0], from = -1;
  path.forEach(([x, y], i) => {
    if (!onPage(page, x, y)) { from = -1; return; }
    if (from < 0) from = i;
    if (i - from + 1 > best[1] - best[0]) best = [from, i + 1];
  });
  return best;
}

// the points of a course on the page, the middle of its longest run on the page first
function crossingOrder(page: Page, path: [number, number][]): number[] {
  const [from, to] = longestRun(page, path), mid = (from + to - 1) / 2;
  return path.map((_, i) => i).filter((i) => onPage(page, path[i][0], path[i][1])).sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid) || a - b);
}

/**
 * A river's name wholly on its page, or not on it. Turned along its water, a name set at the middle of the
 * river's crossing could still run past the page's edge and be cut there — 42 pages of 576 in the census
 * (`regioncensus.ts`) — and the cull cannot slide a turned name back inside the way it slides an upright one.
 * Run with the names at their page size and laid out (exportLabels.ts, before the cull): a name that would
 * cross the frame moves along the river's course on the page, to the point nearest the middle of that course
 * where it fits, lifted off the water as far as the page lifts it; with no such point the river is not named.
 */
export function fitRiverNames(svg: SVGSVGElement, page: Page, rivers: { path: [number, number][]; flux: number }[]): void {
  const pad = FRAME_PAD / page.z;
  const inFrame = (x: number, y: number) => x >= page.x + pad && x <= page.x + page.w - pad && y >= page.y + pad && y <= page.y + page.h - pad;
  for (const el of [...svg.querySelectorAll<SVGGraphicsElement>(".river-label")]) {
    let box: DOMRect;
    try { box = el.getBBox(); } catch { return; }   // no layout: nothing to measure
    const x = Number(el.getAttribute("x")), y = Number(el.getAttribute("y"));
    const turned = Number(/rotate\(\s*(-?[\d.]+)/.exec(el.getAttribute("transform") ?? "")?.[1] ?? 0);
    // the name's box, as it would be drawn standing on (px, py) turned by `deg` about that point
    const fits = (px: number, py: number, deg: number) => {
      const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
      const x0 = box.x - x, y0 = box.y - y;
      return [[x0, y0], [x0 + box.width, y0], [x0, y0 + box.height], [x0 + box.width, y0 + box.height]]
        .every(([dx, dy]) => inFrame(px + dx * c - dy * s, py + dx * s + dy * c));
    };
    if (fits(x, y, turned)) continue;
    const river = rivers[Number((el.getAttribute("data-name") ?? "").slice(1))];
    // the whole map's size, which the lift off the water is set by (labelScale.ts keeps it in data-fs)
    const fs = Number(el.dataset.fs ?? el.getAttribute("font-size"));
    let moved = false;
    for (const i of river ? crossingOrder(page, river.path) : []) {
      const at = riverNameAt(river.path, i, fs), [wx, wy] = river.path[i];
      const px = wx + (at.x - wx) / page.z, py = wy + (at.y - wy) / page.z;
      if (!fits(px, py, at.deg)) continue;
      el.setAttribute("x", num(px));
      el.setAttribute("y", num(py));
      el.setAttribute("transform", `rotate(${at.deg.toFixed(1)} ${num(px)} ${num(py)})`);
      moved = true;
      break;
    }
    if (!moved) el.remove();
  }
}
