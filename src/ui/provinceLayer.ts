import type { World } from "../types/world";
import { svgEl } from "./renderer";
import { cellPath, segPath } from "./svgPaths";
import { politicalBorders } from "../engine/borders";
import type { Province } from "../engine/provinces";

type GridLike = Pick<World["grid"], "count" | "polygons" | "neighbors" | "points">;

// EU4-style: a distinct hue per province (golden-angle spacing) so adjacent provinces read as
// separate regions regardless of biome. Deterministic (id-based) and inline so it survives export.
function provinceColor(id: number): string {
  return `hsl(${((id * 137.508) % 360).toFixed(1)}, 45%, 68%)`;
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
  opts: { fills?: boolean; labels?: boolean; owner?: ArrayLike<number> } = {},
): SVGGElement {
  const { fills = true, labels = true, owner } = opts;
  const g = svgEl("g", { class: "province" }) as SVGGElement;

  if (fills) {
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
        fill: provinceColor(prov.id), "fill-opacity": 0.7,
      });
      const title = svgEl("title");
      title.textContent = prov.name;
      path.appendChild(title);
      g.appendChild(path);
    }
  }

  g.appendChild(svgEl("path", {
    class: "province-border", d: segPath(politicalBorders(grid, provinceOf)),
    fill: "none", stroke: "#3c2f1c", "stroke-width": 1.1, "stroke-opacity": 0.9,
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
