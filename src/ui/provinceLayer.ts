import type { World } from "../types/world";
import { svgEl, legendPanel, INK, LEGEND_TITLE_H } from "./renderer";
import { t, type Lang } from "./i18n";
import { cellPath, segPath } from "./svgPaths";
import { politicalBorders } from "../engine/borders";
import type { Province } from "../engine/provinces";

type GridLike = Pick<World["grid"], "count" | "polygons" | "neighbors" | "points" | "height">;

// EU4-style: a distinct hue per province so adjacent provinces read as separate regions regardless
// of biome. The hue used to be the golden angle over the province ID, which spaces CONSECUTIVE ids
// and knows nothing about who touches whom -- and ids come from farthest-point seeding, so
// neighbours draw arbitrary ones. Measured over 968 touching pairs: a healthy 94-degree median, but
// twelve pairs a world within 15 degrees and 2.5% within 5, which is the same colour either side of
// a hairline. So the hues are dealt against the adjacency instead: a fixed wheel of twelve, each
// province taking the one furthest from the neighbours already dealt. Deterministic (id order, ties
// to the lowest hue), no rng, and inline so it survives export.
const PALETTE = 12;
const hueGap = (a: number, b: number) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };

function assignHues(grid: GridLike, provinceOf: ArrayLike<number>, count: number): number[] {
  const adj: Set<number>[] = Array.from({ length: count }, () => new Set<number>());
  for (let i = 0; i < grid.count; i++) {
    const a = provinceOf[i];
    if (a < 0 || a >= count) continue;
    for (const nb of grid.neighbors[i]) {
      const b = provinceOf[nb];
      if (b >= 0 && b < count && b !== a) adj[a].add(b);
    }
  }
  const hue = new Array(count).fill(-1);
  for (let p = 0; p < count; p++) {
    // Candidates are walked from this province's own golden-angle position rather than from zero.
    // Adjacency still decides -- the first best wins -- but a province whose neighbours are all
    // still unassigned scores every hue equally, and with a fixed starting point every one of those
    // took hue 0: the first map came out dominated by a single pink. Ties now spread instead.
    const start = Math.round((((p * 137.508) % 360) / 360) * PALETTE) % PALETTE;
    let best = 0, bestScore = -1;
    for (let i = 0; i < PALETTE; i++) {
      const h = (((start + i) % PALETTE) * 360) / PALETTE;
      let score = 360;
      for (const q of adj[p]) if (hue[q] >= 0) score = Math.min(score, hueGap(h, hue[q]));
      if (score > bestScore) { bestScore = score; best = h; }
    }
    hue[p] = best;
  }
  return hue;
}

const provinceColor = (hue: number): string => `hsl(${hue.toFixed(1)}, 45%, 68%)`;

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
export function snapOwnersToProvinces(
  count: number, provinceOf: ArrayLike<number>, provinces: Province[], owner: ArrayLike<number>,
): Int32Array {
  const powners = provinceOwners(provinceOf, provinces, owner);
  const snapped = new Int32Array(count).fill(-1);
  for (let c = 0; c < count; c++) { const p = provinceOf[c]; if (p >= 0) snapped[c] = powners[p]; }
  return snapped;
}

// A dedicated "provinces" view layer: faint per-province biome tint (with a <title> so hovering any
// province names it), the province borders (same algorithm the political view uses, fed provinceOf),
// and province-name labels emitted largest-first so deconflictLabels keeps the biggest on collision.
export function provinceLayer(
  grid: GridLike, provinceOf: ArrayLike<number>, provinces: Province[],
  opts: { fills?: boolean; labels?: boolean; owner?: ArrayLike<number>; legend?: boolean; lang?: Lang } = {},
): SVGGElement {
  const { fills = true, labels = true, owner, legend = false, lang = "en" } = opts;
  const g = svgEl("g", { class: "province" }) as SVGGElement;

  if (fills) {
    const hues = assignHues(grid, provinceOf, provinces.length);
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
        fill: provinceColor(hues[prov.id]), "fill-opacity": 0.7,
      });
      const title = svgEl("title");
      title.textContent = prov.name;
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
    ];
    const lg = svgEl("g", { class: "legend province-legend" });
    const x0 = 14, y0 = grid.height - 14 - rows.length * 14;
    lg.appendChild(legendPanel(x0 - 5, y0 - 10 - LEGEND_TITLE_H, 104, rows.length * 14 + 14 + LEGEND_TITLE_H, t(lang, "legendProvinces")));
    rows.forEach(([label, mark], i) => {
      const y = y0 + i * 14;
      lg.appendChild(mark(x0, y));
      const tx = svgEl("text", { x: x0 + 18, y, "font-size": 8.5, fill: INK });
      tx.textContent = label;
      lg.appendChild(tx);
    });
    g.appendChild(lg);
  }

  if (labels) {
    const lg = svgEl("g", { class: "province-labels" });
    for (const prov of [...provinces].sort((a, b) => b.cells - a.cells)) {
      const tx = svgEl("text", {
        class: "province-label", x: prov.centroid[0] + 4, y: prov.centroid[1] + 3,
        "text-anchor": "start", "font-size": 7,
      });
      tx.textContent = prov.name;
      lg.appendChild(tx);
    }
    g.appendChild(lg);
  }
  return g;
}
