import type { World } from "../types/world";
import { svgEl } from "./renderer";
import { OCEAN, BIOME_COLORS, BIOME_NAMES } from "../engine/biome";
import { politicalBorders, coastline } from "../engine/borders";
import type { Segment } from "../engine/borders";

function cellPath(poly: number[][]): string {
  if (!poly.length) return "";
  return "M" + poly.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join("L") + "Z";
}

function segPath(segs: Segment[]): string {
  return segs.map(([a, b]) => `M${a[0].toFixed(1)},${a[1].toFixed(1)}L${b[0].toFixed(1)},${b[1].toFixed(1)}`).join("");
}

export function renderWorld(world: World): SVGSVGElement {
  const grid = world.grid;
  const root = svgEl("svg", {
    width: "100%",
    viewBox: `0 0 ${grid.width} ${grid.height}`,
    class: "world",
  }) as SVGSVGElement;

  root.appendChild(svgEl("rect", { x: 0, y: 0, width: grid.width, height: grid.height, fill: BIOME_COLORS[OCEAN] }));

  // biome fills (ocean is the background rect, so skip OCEAN cells)
  const byBiome = new Map<number, string>();
  for (let i = 0; i < grid.count; i++) {
    const bm = world.biome[i];
    if (bm === OCEAN) continue;
    byBiome.set(bm, (byBiome.get(bm) ?? "") + cellPath(grid.polygons[i]));
  }
  const biomes = svgEl("g", { class: "biomes" });
  for (const [bm, d] of byBiome) {
    biomes.appendChild(svgEl("path", { class: "biome", "data-biome": bm, d, fill: BIOME_COLORS[bm] }));
  }
  root.appendChild(biomes);

  root.appendChild(svgEl("path", {
    class: "coastline", d: segPath(coastline(grid, world.terrain)),
    fill: "none", stroke: "#5f7888", "stroke-width": 0.6,
  }));
  root.appendChild(svgEl("path", {
    class: "border", d: segPath(politicalBorders(grid, world.polityOf)),
    fill: "none", stroke: "#3c2f1c", "stroke-width": 0.8, "stroke-linejoin": "round",
  }));

  const markers = svgEl("g", { class: "markers" });
  for (const c of world.cities) {
    markers.appendChild(svgEl("circle", {
      cx: c.x, cy: c.y, r: c.isCapital ? 4 : 2.5,
      fill: "#222", stroke: "#fff", "stroke-width": 1,
      "data-city": c.id, style: "cursor:pointer",
    }));
    const label = svgEl("text", { x: c.x + 5, y: c.y + 3, "font-size": 9, fill: "#222" });
    label.textContent = c.name;
    markers.appendChild(label);
  }
  root.appendChild(markers);

  // legend: only biomes present on this map
  const present = [...byBiome.keys()].sort((a, b) => a - b);
  const legend = svgEl("g", { class: "legend" });
  const x0 = 8, y0 = grid.height - 10 - present.length * 14;
  legend.appendChild(svgEl("rect", {
    x: x0 - 5, y: y0 - 10, width: 104, height: present.length * 14 + 14, rx: 3,
    fill: "#f7f2e6", "fill-opacity": 0.92, stroke: "#cbb784", "stroke-width": 0.5,
  }));
  present.forEach((bm, i) => {
    const y = y0 + i * 14;
    legend.appendChild(svgEl("rect", { class: "legend-item", x: x0, y: y - 8, width: 10, height: 10, fill: BIOME_COLORS[bm], stroke: "#9a8a70", "stroke-width": 0.4 }));
    const t = svgEl("text", { x: x0 + 16, y: y, "font-size": 9, fill: "#4a3f2c" });
    t.textContent = BIOME_NAMES[bm] ?? "";
    legend.appendChild(t);
  });
  root.appendChild(legend);

  return root;
}
