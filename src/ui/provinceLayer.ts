import type { World } from "../types/world";
import { svgEl, legendPanel, legendRow, INK, LEGEND_TITLE_H, LEGEND_TEXT, LEGEND_ROW, LEGEND_SWATCH, LEGEND_GAP, LEGEND_W_FIXED, roadMark, seaRouteMark, type KeyRow } from "./renderer";
import { t, type Lang } from "./i18n";
import { cellPath, segPath } from "./svgPaths";
import { politicalBorders } from "../engine/borders";
import type { Province } from "../engine/provinces";
import { featureLabel } from "../engine/featureLabel";
import { nationColor } from "./nationPalette";
import { FILL_OPACITY } from "./politicalLayer";
import { lighter } from "./colour";

type GridLike = Pick<World["grid"], "count" | "polygons" | "neighbors" | "points" | "height">;

/**
 * ★ A province is painted in its REALM's colour, a step lighter than its neighbours of the same realm.
 *
 * It used to take a hue of its own — twelve dealt against the adjacency so no two touching provinces
 * matched — at 45% saturation and 68% lightness over the land: fifty pieces of lilac, mint and pink that
 * read as a data-visualization demo beside the atlas's other views, and said nothing about whose the
 * province was (design review 2026-10-15, item 9). Now the fill is the colour the political view paints
 * the realm (the caller's `colorOf`, the same function the realms' view and its key read), at the same
 * opacity, lightened by one of four steps so that two touching provinces of one realm still part at
 * their hairline: the view reads as realms made of provinces, and a reader switching from the realms'
 * view meets the colours they just saw. A province no realm holds, or a layer given no owners, is a warm
 * grey in the same steps. The steps are dealt against the adjacency as the hues were: each province
 * takes the first step none of its already-dealt neighbours OF THE SAME COLOUR wears (ids in order, no
 * rng), and inline so it survives export.
 */
export const PROVINCE_STEPS = [0, 0.22, 0.44, 0.11, 0.33];
export const PROVINCE_FILL_OPACITY = FILL_OPACITY;
export const UNCLAIMED_COLOUR = "#9a9080";

function assignSteps(grid: GridLike, provinceOf: ArrayLike<number>, base: string[]): number[] {
  const count = base.length;
  const adj: Set<number>[] = Array.from({ length: count }, () => new Set<number>());
  for (let i = 0; i < grid.count; i++) {
    const a = provinceOf[i];
    if (a < 0 || a >= count) continue;
    for (const nb of grid.neighbors[i]) {
      const b = provinceOf[nb];
      if (b >= 0 && b < count && b !== a) adj[a].add(b);
    }
  }
  const step = new Array<number>(count).fill(-1);
  for (let p = 0; p < count; p++) {
    const taken = new Set<number>();
    for (const q of adj[p]) if (step[q] >= 0 && base[q] === base[p]) taken.add(step[q]);
    let s = 0;
    while (s < PROVINCE_STEPS.length - 1 && taken.has(s)) s++;
    // five steps: with four, world 1 had two touching pairs of one realm wearing the same step (its greedy
    // walk met a province whose four dealt neighbours held all four); past five, the least-taken step
    if (taken.has(s)) { let best = 0, fewest = Infinity; for (let k = 0; k < PROVINCE_STEPS.length; k++) { let n = 0; for (const q of adj[p]) if (step[q] === k && base[q] === base[p]) n++; if (n < fewest) { fewest = n; best = k; } } s = best; }
    step[p] = s;
  }
  return step;
}

// each province's majority-owner nation (the nation holding the most of its cells); ties → lower id,
// -1 if the province is mostly unclaimed. Snapping ownership to whole provinces makes nation borders
// follow province edges (EU4: you own whole provinces) instead of cutting through them cell-by-cell.
export function provinceOwners(
  provinceOf: ArrayLike<number>, provinces: Province[], owner: ArrayLike<number>,
): number[] {
  const tally: Map<number, number>[] = provinces.map(() => new Map());
  for (let c = 0; c < provinceOf.length; c++) {
    const p = provinceOf[c];
    if (p < 0 || p >= tally.length) continue;
    const o = owner[c];
    if (o < 0) continue;
    tally[p].set(o, (tally[p].get(o) ?? 0) + 1);
  }
  return provinces.map((_, p) => {
    let best = -1, bestN = 0;
    for (const [o, n] of tally[p]) if (n > bestN || (n === bestN && o < best)) { bestN = n; best = o; }
    return best;
  });
}

// per-cell ownership SNAPPED to whole provinces: every cell takes its province's majority owner
// (via provinceOwners); ocean / province-less cells stay -1. Feed this to politicalBorders /
// politicalLayer and the nation borders + fills fall on province edges — the EU4 whole-province
// model — so every map view (terrain/political/province) agrees on where a country ends.
/**
 * `keep` names the realms an enclave smaller than a province belongs to — their cells are left
 * exactly as the simulation recorded them instead of being rounded up to whoever holds the province
 * around them.
 *
 * Snapping exists so political borders fall on province edges and the two views agree, and that is
 * worth an exception here rather than a rule. A free city holds five cells; a province is far
 * bigger; so the snap erased every free city from the map. Measured on seed 1 at year 500: all four
 * free realms still held their own seats in the simulation AND said so in the gazetteer, while the
 * map and the city list showed the surrounding empire — one screen, two answers to "who holds this
 * town". It also left the free-city markers this file draws permanently invisible, because their
 * anchor was computed from the array that had just erased them.
 *
 * ⚠ Not applied by the province view, which is ABOUT provinces: a hole in it would spoil the thing
 * that view exists to show.
 */
export function snapOwnersToProvinces(
  count: number, provinceOf: ArrayLike<number>, provinces: Province[], owner: ArrayLike<number>,
  keep?: ReadonlySet<number>,
): Int32Array {
  const powners = provinceOwners(provinceOf, provinces, owner);
  const snapped = new Int32Array(count).fill(-1);
  for (let c = 0; c < count; c++) {
    const o = owner[c];
    if (keep !== undefined && o >= 0 && keep.has(o)) { snapped[c] = o; continue; }
    const p = provinceOf[c];
    if (p >= 0) snapped[c] = powners[p];
  }
  return snapped;
}

// A dedicated "provinces" view layer: faint per-province biome tint (with a <title> so hovering any
// province names it), the province borders (same algorithm the political view uses, fed provinceOf),
// and province-name labels emitted largest-first so deconflictLabels keeps the biggest on collision.
export function provinceLayer(
  grid: GridLike, provinceOf: ArrayLike<number>, provinces: Province[],
  // `roads`: the map draws roads between the towns (the key then says which line they are)
  // `keyRows`: rows the key carries under its own, worded and drawn by the caller (settlementKey.ts)
  // `colorOf`: what colour a realm is painted — the political view's own function, so the two views agree
  opts: { fills?: boolean; labels?: boolean; owner?: ArrayLike<number>; colorOf?: (id: number) => string; legend?: boolean; lang?: Lang; roads?: boolean; seaRoutes?: boolean; keyRows?: KeyRow[] } = {},
): SVGGElement {
  const { fills = true, labels = true, owner, colorOf = nationColor, legend = false, lang = "en", roads = false, seaRoutes = false, keyRows = [] } = opts;
  // A province name is a composite ("Barrens of Dimbrerk"), so it is rebuilt from its parts rather
  // than transliterated. This is the view with the most lettering on it — roughly a hundred labels
  // — and it was the last one still drawing English at a Korean reader.
  const provinceName = (p: Province) => featureLabel(p.label, lang);
  const g = svgEl("g", { class: "province" }) as SVGGElement;

  if (fills) {
    // each province's realm (the one holding most of it), and so its colour; none → the grey
    const owners = owner ? provinceOwners(provinceOf, provinces, owner) : provinces.map(() => -1);
    const base = provinces.map((p) => (owners[p.id] >= 0 ? colorOf(owners[p.id]) : UNCLAIMED_COLOUR));
    const steps = assignSteps(grid, provinceOf, base);
    const byProv: string[] = provinces.map(() => "");
    for (let i = 0; i < grid.count; i++) {
      const p = provinceOf[i];
      if (p < 0 || p >= byProv.length) continue;
      byProv[p] += cellPath(grid.polygons[i]);
    }
    for (const prov of provinces) {
      if (!byProv[prov.id]) continue;
      const path = svgEl("path", {
        class: "province-fill", "data-province": prov.id, d: byProv[prov.id],
        fill: lighter(base[prov.id], PROVINCE_STEPS[steps[prov.id]]), "fill-opacity": PROVINCE_FILL_OPACITY,
      });
      const title = svgEl("title");
      title.textContent = provinceName(prov);
      path.appendChild(title);
      g.appendChild(path);
    }
  }

  // non-scaling-stroke, as every other line on this map has: zoom rewrites the viewBox, so without
  // it these are drawn at their width TIMES the zoom. Measured at 7.53x before this: the mesh at 8.3
  // screen pixels and the country outline at 15, beside a coastline still holding its 2.4.
  g.appendChild(svgEl("path", {
    class: "province-border", d: segPath(politicalBorders(grid, provinceOf)),
    fill: "none", stroke: "#3c2f1c", "stroke-width": 1.1, "stroke-opacity": 0.9,
    "vector-effect": "non-scaling-stroke",
  }));

  // nation (country) borders, when an owner array is supplied: ownership is SNAPPED to whole provinces
  // (each province → its majority owner) so the border follows province edges, never cutting through a
  // province. Drawn BOLD + dark ON TOP of the thin province lines (EU4: fine province mesh + heavy
  // country outlines). In Version A the owner tracks the timeline year.
  if (owner) {
    const snapped = snapOwnersToProvinces(grid.count, provinceOf, provinces, owner);
    g.appendChild(svgEl("path", {
      class: "nation-border", d: segPath(politicalBorders(grid, snapped)),
      fill: "none", stroke: "#161009", "stroke-width": 2, "stroke-opacity": 0.95, "stroke-linejoin": "round",
      "vector-effect": "non-scaling-stroke",
    }));
  }

  // settlement seats: a small dot at each province's centre so every province visibly "has a city"
  const seats = svgEl("g", { class: "province-seats" });
  for (const prov of provinces) {
    seats.appendChild(svgEl("circle", {
      class: "province-seat", cx: prov.centroid[0], cy: prov.centroid[1], r: 1.6,
      fill: "#2a2118", stroke: "#f4ecd8", "stroke-width": 0.6,
    }));
  }
  g.appendChild(seats);

  // Of the four views this was the only one with no key, and the one an outside review found
  // hardest to read. Its COLOURS cannot be listed — a hundred provinces, hues dealt against
  // adjacency — but the thing a reader actually has to be told is what the two weights of line
  // mean: thin is a province, heavy is the country made of them, and the dot is where a province
  // is governed from.
  if (legend) {
    const rows: [string, (x: number, y: number) => SVGElement][] = [
      [t(lang, "keyProvinceBorder"), (x, y) => svgEl("line", { x1: x, y1: y - 3, x2: x + 12, y2: y - 3, stroke: "#3c2f1c", "stroke-width": 1.1, "stroke-opacity": 0.9 })],
      [t(lang, "keyRealmBorder"), (x, y) => svgEl("line", { x1: x, y1: y - 3, x2: x + 12, y2: y - 3, stroke: "#161009", "stroke-width": 2, "stroke-opacity": 0.95 })],
      [t(lang, "keySeat"), (x, y) => svgEl("circle", { cx: x + 6, cy: y - 3, r: 1.6, fill: "#2a2118", stroke: "#f4ecd8", "stroke-width": 0.6 })],
      // ...and the third kind of line on it, which runs between the seats
      ...(roads ? [[t(lang, "keyRoad"), roadMark] as [string, (x: number, y: number) => SVGElement]] : []),
      ...(seaRoutes ? [[t(lang, "keySeaRoute"), seaRouteMark] as [string, (x: number, y: number) => SVGElement]] : []),
      // ...and the marks over it all: the capitals, the towns (not the seats' dots), the free ports
      ...keyRows,
    ];
    const lg = svgEl("g", { class: "legend province-legend" });
    const x0 = 14, y0 = grid.height - 14 - rows.length * LEGEND_ROW;
    lg.appendChild(legendPanel(x0 - 5, y0 - 10 - LEGEND_TITLE_H, LEGEND_W_FIXED, rows.length * LEGEND_ROW + 14 + LEGEND_TITLE_H, t(lang, "legendProvinces")));
    rows.forEach(([label, mark], i) => {
      const y = y0 + i * LEGEND_ROW;
      const row = legendRow(LEGEND_ROW);
      row.appendChild(mark(x0, y));
      const tx = svgEl("text", { x: x0 + LEGEND_SWATCH + LEGEND_GAP, y, "font-size": LEGEND_TEXT, fill: INK });
      tx.textContent = label;
      row.appendChild(tx);
      lg.appendChild(row);
    });
    g.appendChild(lg);
  }

  if (labels) {
    const lg = svgEl("g", { class: "province-labels" });
    // the larger quarter (twelve at least) are named at rest; the rest wait for a zoom (deconflict.ts tiers):
    // a hundred names at 7 units were a thicket — 83 on screen at 8.6px (design review 2026-10-15, item 9)
    const major = Math.min(provinces.length, Math.max(12, Math.ceil(provinces.length / 4)));
    [...provinces].sort((a, b) => b.cells - a.cells).forEach((prov, rank) => {
      const tx = svgEl("text", {
        class: "province-label" + (rank < major ? " province-major" : ""), "data-name": `p${prov.id}`, x: prov.centroid[0] + 4, y: prov.centroid[1] + 3,
        "text-anchor": "start", "font-size": 7,
      });
      tx.textContent = provinceName(prov);
      lg.appendChild(tx);
    });
    g.appendChild(lg);
  }
  return g;
}
