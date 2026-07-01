import type { World } from "../types/world";
import { svgEl } from "./renderer";
import { cellPath, segPath } from "./svgPaths";
import { politicalBorders } from "../engine/borders";

type GridLike = Pick<World["grid"], "count" | "polygons" | "neighbors">;

export function politicalLayer(
  grid: GridLike,
  owner: ArrayLike<number>,
  polities: { id: number; color: string }[],
): SVGGElement {
  const g = svgEl("g", { class: "political" }) as SVGGElement;

  const byPolity = new Map<number, string>();
  for (let i = 0; i < grid.count; i++) {
    const o = owner[i];
    if (o < 0) continue;
    byPolity.set(o, (byPolity.get(o) ?? "") + cellPath(grid.polygons[i]));
  }

  const colorOf = new Map(polities.map((p) => [p.id, p.color]));
  for (const [id, d] of byPolity) {
    g.appendChild(svgEl("path", {
      class: "territory", "data-polity": id, d,
      fill: colorOf.get(id) ?? "#888888", "fill-opacity": 0.33,
    }));
  }

  g.appendChild(svgEl("path", {
    class: "border", d: segPath(politicalBorders(grid, owner)),
    fill: "none", stroke: "#3c2f1c", "stroke-width": 0.8, "stroke-linejoin": "round",
  }));

  return g;
}
