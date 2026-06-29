import type { World } from "../types/world";
import { svgEl } from "./renderer";
import { MOUNTAIN } from "../engine/terrain";

function cellPath(poly: number[][]): string {
  if (!poly.length) return "";
  return "M" + poly.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join("L") + "Z";
}

export function renderWorld(world: World): SVGSVGElement {
  const { grid } = world;
  const root = svgEl("svg", {
    width: "100%",
    viewBox: `0 0 ${grid.width} ${grid.height}`,
    class: "world",
  }) as SVGSVGElement;

  root.appendChild(svgEl("rect", { x: 0, y: 0, width: grid.width, height: grid.height, fill: "#a9c7e0" }));

  const byPolity = new Map<number, string>();
  for (let i = 0; i < grid.count; i++) {
    const p = world.polityOf[i];
    if (p < 0) continue;
    byPolity.set(p, (byPolity.get(p) ?? "") + cellPath(grid.polygons[i]));
  }
  const regions = svgEl("g", { class: "regions" });
  for (const pol of world.polities) {
    const d = byPolity.get(pol.id);
    if (d) regions.appendChild(svgEl("path", { d, fill: pol.color, stroke: "#5a5a5a", "stroke-width": 0.3 }));
  }
  root.appendChild(regions);

  const mtns = svgEl("g", { class: "mountains" });
  for (let i = 0; i < grid.count; i++) {
    if (world.terrain[i] !== MOUNTAIN) continue;
    const d = cellPath(grid.polygons[i]);
    if (d) mtns.appendChild(svgEl("path", { d, fill: "#9a8d7a", "fill-opacity": 0.6 }));
  }
  root.appendChild(mtns);

  const markers = svgEl("g", { class: "markers" });
  for (const c of world.cities) {
    markers.appendChild(
      svgEl("circle", {
        cx: c.x, cy: c.y, r: c.isCapital ? 4 : 2.5,
        fill: "#222", stroke: "#fff", "stroke-width": 1,
        "data-city": c.id, style: "cursor:pointer",
      })
    );
    const label = svgEl("text", { x: c.x + 5, y: c.y + 3, "font-size": 9, fill: "#222" });
    label.textContent = c.name;
    markers.appendChild(label);
  }
  root.appendChild(markers);

  return root;
}
