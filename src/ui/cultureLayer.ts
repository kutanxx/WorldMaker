import type { World } from "../types/world";
import { svgEl, legendPanel, INK, LEGEND_TITLE_H, LEGEND_TEXT } from "./renderer";
import { t } from "./i18n";
import type { Lang } from "./i18n";
import { cellPath, segPath } from "./svgPaths";
import { politicalBorders } from "../engine/borders";
import { nationCentroids } from "./nationPalette";

type GridLike = Pick<World["grid"], "count" | "polygons" | "points" | "width" | "height" | "neighbors">;

const MIN_LABEL_CELLS = 20;
// How much of the culture's own colour the reader gets, and so -- since the rest is the biome
// showing through -- how much of the terrain survives beneath it. The two are the same trade.
// 0.55 let so much biome through that one culture's ground varied more than two cultures differed.
// Raising it was measured against the alternative of muting the biomes instead: that lowers the
// variation without raising the separation, because two cultures meeting on the SAME biome are
// separated by this number alone.
export const CULTURE_FILL_OPACITY = 0.7;
const LEGEND_W = 120;

export function cultureLayer(
  grid: GridLike,
  cultureOf: ArrayLike<number>,
  cultures: { name: string; color: string }[],
  lang: Lang = "en",
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
      fill: cultures[id]?.color ?? "#888888", "fill-opacity": CULTURE_FILL_OPACITY,
    }));
  }

  // Where two cultures meet, draw the line. The political and province views both do; this one had
  // only its fills, and the palette cannot carry the distinction alone -- composited over the biomes
  // beneath, the closest pair of culture colours separates by dE 14.8, less than a single culture
  // varies across the biomes it covers (19.2). Dashed and lighter than a national border, which is
  // the ethnographic convention: a culture shades into its neighbour, a realm does not.
  g.appendChild(svgEl("path", {
    class: "culture-border", d: segPath(politicalBorders(grid, cultureOf)),
    fill: "none", stroke: INK, "stroke-width": 1.1, "stroke-opacity": 0.75,
    "stroke-dasharray": "5 3.5", "vector-effect": "non-scaling-stroke", "stroke-linejoin": "round",
  }));

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
  legend.appendChild(legendPanel(x0 - 5, y0 - 10 - LEGEND_TITLE_H, LEGEND_W, present.length * 14 + 14 + LEGEND_TITLE_H, t(lang, "legendCultures")));
  present.forEach((id, i) => {
    const y = y0 + i * 14;
    legend.appendChild(svgEl("rect", { class: "legend-item", x: x0, y: y - 8, width: 10, height: 10, fill: cultures[id]?.color ?? "#888", stroke: INK, "stroke-width": 0.6, "vector-effect": "non-scaling-stroke" }));
    const t = svgEl("text", { x: x0 + 18, y, "font-size": LEGEND_TEXT, fill: "#42341f", "letter-spacing": 0.3 });
    t.textContent = cultures[id]?.name ?? "";
    legend.appendChild(t);
  });
  g.appendChild(legend);

  return g;
}
