import type { CityLayout } from "../engine/city";
import { svgEl } from "./renderer";

const FILL: Record<string, string> = {
  keep: "#b9a07a",
  market: "#d8b86a",
  residential: "#cdbb96",
};

export function renderCity(layout: CityLayout): SVGSVGElement {
  const root = svgEl("svg", { width: "100%", viewBox: "0 0 300 300", class: "city" }) as SVGSVGElement;
  root.appendChild(svgEl("rect", { x: 0, y: 0, width: 300, height: 300, fill: "#efe7d2" }));

  if (layout.river) {
    root.appendChild(
      svgEl("polyline", {
        class: "river",
        points: layout.river.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" "),
        fill: "none", stroke: "#7d9bb0", "stroke-width": 6, "stroke-linecap": "round",
      })
    );
  }

  root.appendChild(
    svgEl("polygon", {
      class: "wall",
      points: layout.wall.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" "),
      fill: "#f5efdd", stroke: "#6b4f2a", "stroke-width": 3,
    })
  );

  for (const d of layout.districts) {
    root.appendChild(
      svgEl("rect", {
        class: "district",
        x: d.x.toFixed(1), y: d.y.toFixed(1), width: d.w.toFixed(1), height: d.h.toFixed(1),
        fill: FILL[d.kind], stroke: "#6b4f2a", "stroke-width": 0.8,
      })
    );
  }

  const label = svgEl("text", { x: 150, y: 20, "font-size": 14, fill: "#3a2a14", "text-anchor": "middle" });
  label.textContent = layout.name;
  root.appendChild(label);

  return root;
}
