import { generateWorld } from "../engine/world";
import { DEFAULT_PARAMS } from "../types/world";
import { initProvinceSim } from "../engine/provinceSim";
import { politicalLayer } from "./politicalLayer";
import { politicalBorders } from "../engine/borders";
import { segPath } from "./svgPaths";
import { PLAYER_COLOR } from "./nationPalette";
import { svgEl } from "./renderer";
import { detectLang } from "./lang";

// per-cell owner = the owner of the cell's province (ocean/unowned → -1). Feeding this to politicalLayer
// paints whole provinces in their nation's colour (the EU4 whole-province model) and yields data-polity paths.
export function provinceCellOwner(count: number, provinceOf: ArrayLike<number>, provOwner: Int32Array): Int32Array {
  const out = new Int32Array(count).fill(-1);
  for (let c = 0; c < count; c++) { const p = provinceOf[c]; if (p >= 0) out[c] = provOwner[p]; }
  return out;
}

export function mountProvinceApp(root: HTMLElement, opts: { seed?: number } = {}): void {
  const lang = detectLang();
  const seed = opts.seed ?? (Math.floor(Date.now() % 1_000_000)); // non-deterministic seed is fine — UI only
  const world = generateWorld({ ...DEFAULT_PARAMS, seed }).world;
  const s = initProvinceSim(world);
  const owner = provinceCellOwner(world.grid.count, world.provinceOf, s.provOwner);

  root.innerHTML = "";
  const svg = svgEl("svg", {
    class: "prov-map", viewBox: `0 0 ${world.grid.width} ${world.grid.height}`,
    preserveAspectRatio: "xMidYMid meet",
  }) as SVGSVGElement;
  svg.appendChild(politicalLayer(
    world.grid, owner, world.polities,
    { fills: true, labels: true, legend: false, playerColor: PLAYER_COLOR },
  ));
  // politicalLayer's own border path is unclassed as "nation-border" (that class belongs to
  // provinceLayer's owner overlay) — since `owner` here is already province-snapped, draw the same
  // bold country-outline overlay directly so every province view agrees on where a country ends.
  svg.appendChild(svgEl("path", {
    class: "nation-border", d: segPath(politicalBorders(world.grid, owner)),
    fill: "none", stroke: "#161009", "stroke-width": 2, "stroke-opacity": 0.95, "stroke-linejoin": "round",
  }));
  root.appendChild(svg);
  void lang; // (used by picker/HUD strings in Task 4)
}
