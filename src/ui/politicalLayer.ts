import type { World } from "../types/world";
import { svgEl } from "./renderer";
import { cellPath, segPath } from "./svgPaths";
import { politicalBorders } from "../engine/borders";
import { nationColor, nationCentroids } from "./nationPalette";

type GridLike = Pick<World["grid"], "count" | "polygons" | "neighbors" | "points" | "width" | "height">;

export interface PoliticalOpts {
  fills?: boolean;
  labels?: boolean;
  legend?: boolean;
}

const MIN_LABEL_CELLS = 25;
const LEGEND_W = 112;

const FREE_COLOR = "#b7b1a4"; // neutral grey for independent free cities

export function politicalLayer(
  grid: GridLike,
  owner: ArrayLike<number>,
  polities: { id: number; name?: string; free?: boolean }[],
  opts: PoliticalOpts = {},
): SVGGElement {
  const g = svgEl("g", { class: "political" }) as SVGGElement;
  const nameOf = new Map(polities.map((p) => [p.id, p.name]));
  const freeSet = new Set(polities.filter((p) => p.free).map((p) => p.id));

  if (opts.fills) {
    const byPolity = new Map<number, string>();
    for (let i = 0; i < grid.count; i++) {
      const o = owner[i];
      if (o < 0) continue;
      byPolity.set(o, (byPolity.get(o) ?? "") + cellPath(grid.polygons[i]));
    }
    for (const [id, d] of byPolity) {
      const free = freeSet.has(id);
      g.appendChild(svgEl("path", {
        class: free ? "territory free-city" : "territory", "data-polity": id, d,
        fill: free ? FREE_COLOR : nationColor(id), "fill-opacity": free ? 0.72 : 0.58,
      }));
    }
  }

  g.appendChild(svgEl("path", {
    class: "border", d: segPath(politicalBorders(grid, owner)),
    fill: "none", stroke: "#3c2f1c", "stroke-width": opts.fills ? 1.0 : 0.7,
    "stroke-linejoin": "round",
  }));

  if (opts.labels || opts.legend) {
    const centroids = nationCentroids(grid, owner);

    if (opts.labels) {
      const labels = svgEl("g", { class: "nation-labels" });
      for (const [id, c] of centroids) {
        if (c.cells < MIN_LABEL_CELLS) continue;
        const name = nameOf.get(id);
        if (!name) continue;
        const t = svgEl("text", {
          class: "nation-label", x: c.x, y: c.y, "text-anchor": "middle",
          "font-size": 11, fill: "#2a2118", stroke: "#f3ead2", "stroke-width": 2.5,
          "paint-order": "stroke", "stroke-linejoin": "round",
        });
        t.textContent = name;
        labels.appendChild(t);
      }
      g.appendChild(labels);
    }

    if (opts.legend) {
      const rows = [...centroids.entries()]
        .filter(([id]) => nameOf.get(id))
        .sort((a, b) => b[1].cells - a[1].cells)
        .slice(0, 10);
      const legend = svgEl("g", { class: "nation-legend" });
      const x0 = grid.width - LEGEND_W - 10;
      const y0 = grid.height - 14 - rows.length * 14;
      legend.appendChild(svgEl("rect", {
        x: x0 - 5, y: y0 - 10, width: LEGEND_W, height: rows.length * 14 + 14, rx: 3,
        fill: "#f7f2e6", "fill-opacity": 0.92, stroke: "#cbb784", "stroke-width": 0.5,
      }));
      rows.forEach(([id], i) => {
        const y = y0 + i * 14;
        legend.appendChild(svgEl("rect", {
          class: "legend-item", x: x0, y: y - 8, width: 10, height: 10,
          fill: nationColor(id), stroke: "#9a8a70", "stroke-width": 0.4,
        }));
        const t = svgEl("text", { x: x0 + 16, y, "font-size": 9, fill: "#4a3f2c" });
        t.textContent = nameOf.get(id) ?? "";
        legend.appendChild(t);
      });
      g.appendChild(legend);
    }
  }

  return g;
}
