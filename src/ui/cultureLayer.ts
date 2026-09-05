import type { World } from "../types/world";
import { svgEl, legendPanel, INK } from "./renderer";
import { cellPath } from "./svgPaths";
import { nationCentroids } from "./nationPalette";

type GridLike = Pick<World["grid"], "count" | "polygons" | "points" | "width" | "height">;

const MIN_LABEL_CELLS = 20;
const LEGEND_W = 120;

export function cultureLayer(
  grid: GridLike,
  cultureOf: ArrayLike<number>,
  cultures: { name: string; color: string }[],
): SVGGElement {
  const g = svgEl("g", { class: "culture" }) as SVGGElement;

  const byCulture = new Map<number, string>();
  for (let i = 0; i < grid.count; i++) {
    const c = cultureOf[i];
    if (c < 0) continue;
    byCulture.set(c, (byCulture.get(c) ?? "") + cellPath(grid.polygons[i]));
  }
  for (const [id, d] of byCulture) {
    g.appendChild(svgEl("path", {
      class: "culture-area", "data-culture": id, d,
      fill: cultures[id]?.color ?? "#888888", "fill-opacity": 0.55,
    }));
  }

  const cents = nationCentroids(grid, cultureOf);
  const labels = svgEl("g", { class: "culture-labels" });
  for (const [id, c] of cents) {
    if (c.cells < MIN_LABEL_CELLS || !cultures[id]) continue;
    const t = svgEl("text", {
      class: "culture-label", x: c.x.toFixed(1), y: c.y.toFixed(1), "text-anchor": "middle",
      "font-size": 13, fill: "#2a2118", stroke: "#f3ead2", "stroke-width": 2.6,
      "paint-order": "stroke", "stroke-linejoin": "round",
    });
    t.textContent = cultures[id].name;
    labels.appendChild(t);
  }
  g.appendChild(labels);

  const present = [...byCulture.keys()].sort((a, b) => a - b);
  const legend = svgEl("g", { class: "legend culture-legend" });
  // bottom-LEFT, matching the biome legend: only one legend is drawn per view, and the
      // bottom-right corner belongs to the zoom controls, which were sitting on top of this one.
      const x0 = 14;
  const y0 = grid.height - 14 - present.length * 14;
  legend.appendChild(legendPanel(x0 - 5, y0 - 10, LEGEND_W, present.length * 14 + 14));
  present.forEach((id, i) => {
    const y = y0 + i * 14;
    legend.appendChild(svgEl("rect", { class: "legend-item", x: x0, y: y - 8, width: 10, height: 10, fill: cultures[id]?.color ?? "#888", stroke: INK, "stroke-width": 0.6, "vector-effect": "non-scaling-stroke" }));
    const t = svgEl("text", { x: x0 + 16, y, "font-size": 9, fill: "#42341f", "letter-spacing": 0.3 });
    t.textContent = cultures[id]?.name ?? "";
    legend.appendChild(t);
  });
  g.appendChild(legend);

  return g;
}
