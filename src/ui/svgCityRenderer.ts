import { svgEl } from "./renderer";
import type { CityLayout } from "../engine/city";
import type { WardType } from "../engine/city/zoning";
import type { Polygon, Polyline } from "../engine/geometry";

const WARD_TINT: Partial<Record<WardType, string>> = {
  plaza: "#e7dcb8", castle: "#d8d2c4", cathedral: "#e0d6e4", guildhall: "#dce0d2",
  market: "#ece0c2", merchant: "#e6dcc0", patriciate: "#e8e0cc", craftsmen: "#e3d8be",
  gate: "#e0d6bc", slum: "#dccdaa", harbor: "#cdd9dd", military: "#dcd6c8",
  park: "#cfe0c0", suburb: "#e6ddc6", field: "#dfe2c2",
};
const ROOF: Partial<Record<WardType, string>> = {
  patriciate: "#c9b08a", merchant: "#cbb088", market: "#d2b06a", craftsmen: "#c2a87e",
  gate: "#c4ac82", slum: "#b9a17a", harbor: "#a9967a", military: "#b6ad96", suburb: "#cbb592",
};

function pts(poly: Polygon | Polyline): string {
  return poly.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
}

export function renderCity(layout: CityLayout): SVGSVGElement {
  const { w, h } = layout.bounds;
  const root = svgEl("svg", { width: "100%", viewBox: `0 0 ${w} ${h}`, class: "city" }) as SVGSVGElement;
  root.appendChild(svgEl("rect", { x: 0, y: 0, width: w, height: h, fill: "#efe7d2" }));

  if (layout.water) {
    root.appendChild(svgEl("polygon", { class: "water", points: pts(layout.water.polygon), fill: "#a9c4d4" }));
  }
  if (layout.moat) {
    root.appendChild(svgEl("polygon", { class: "moat", points: pts(layout.moat), fill: "none", stroke: "#8fb0c2", "stroke-width": 4 }));
  }

  const wardsG = svgEl("g", { class: "wards" });
  for (const ward of layout.wards) {
    const g = svgEl("g", { class: "ward" });
    g.appendChild(svgEl("polygon", { points: pts(ward.polygon), fill: WARD_TINT[ward.type] ?? "#e6ddc6", stroke: "none" }));
    wardsG.appendChild(g);
  }
  root.appendChild(wardsG);

  const roadsG = svgEl("g", { class: "roads" });
  for (const r of layout.roads) {
    roadsG.appendChild(svgEl("polyline", { class: "road", points: pts(r), fill: "none", stroke: "#d8c5a0", "stroke-width": 5, "stroke-linecap": "round", "stroke-linejoin": "round" }));
  }
  root.appendChild(roadsG);

  const buildG = svgEl("g", { class: "buildings" });
  for (const ward of layout.wards) {
    const fill = landmarkFill(ward.type) ?? ROOF[ward.type] ?? "#cbb18c";
    for (const b of ward.buildings) {
      buildG.appendChild(svgEl("polygon", { class: "building", points: pts(b), fill, stroke: "#7a5a34", "stroke-width": 0.5 }));
    }
  }
  root.appendChild(buildG);

  drawLandmarks(root, layout);

  if (layout.wall) {
    root.appendChild(svgEl("polygon", { class: "wall", points: pts(layout.wall.ring), fill: "none", stroke: "#6b4f2a", "stroke-width": 3 }));
    const tg = svgEl("g", { class: "towers" });
    for (const t of layout.wall.towers) {
      tg.appendChild(svgEl("circle", { class: "tower", cx: t[0], cy: t[1], r: 3.2, fill: "#8a6a3c", stroke: "#5a3f22", "stroke-width": 1 }));
    }
    root.appendChild(tg);
    const gg = svgEl("g", { class: "gates" });
    for (const ga of layout.wall.gates) {
      gg.appendChild(svgEl("rect", { class: "gate", x: ga[0] - 3, y: ga[1] - 3, width: 6, height: 6, fill: "#5a3f22" }));
    }
    root.appendChild(gg);
  }

  const labelsG = svgEl("g", { class: "labels" });
  for (const l of layout.labels) {
    const t = svgEl("text", { x: l.x, y: l.y, "font-size": 7, fill: "#3a2a14", "text-anchor": "middle" });
    t.textContent = l.text;
    labelsG.appendChild(t);
  }
  root.appendChild(labelsG);

  const title = svgEl("text", { x: w / 2, y: 14, "font-size": 13, fill: "#3a2a14", "text-anchor": "middle" });
  title.textContent = layout.name;
  root.appendChild(title);

  drawLegend(root, layout);
  return root;
}

function landmarkFill(type: WardType): string | null {
  if (type === "castle") return "#b9bcc2";
  if (type === "cathedral") return "#d6c2dd";
  if (type === "guildhall") return "#cfc89a";
  return null;
}

function drawLandmarks(root: SVGSVGElement, layout: CityLayout) {
  for (const ward of layout.wards) {
    if (ward.type === "cathedral") {
      const c = avg(ward.polygon);
      root.appendChild(svgEl("path", { class: "landmark", d: `M${c[0]} ${c[1] - 8} v16 M${c[0] - 5} ${c[1] - 3} h10`, stroke: "#7a5a86", "stroke-width": 2, fill: "none" }));
    }
  }
}

function avg(poly: Polygon): [number, number] {
  let x = 0, y = 0;
  for (const [px, py] of poly) { x += px; y += py; }
  return [x / poly.length, y / poly.length];
}

function drawLegend(root: SVGSVGElement, layout: CityLayout) {
  const present = new Set(layout.wards.map((w) => w.type));
  const entries: [WardType, string][] = [
    ["castle", "Keep"], ["cathedral", "Cathedral"], ["guildhall", "Guildhall"],
    ["plaza", "Market"], ["harbor", "Harbor"], ["slum", "Slums"],
  ];
  const shown = entries.filter(([t]) => present.has(t));
  const g = svgEl("g", { class: "legend" });
  const x0 = 6, y0 = layout.bounds.h - 8 - shown.length * 11;
  g.appendChild(svgEl("rect", { x: x0 - 4, y: y0 - 8, width: 92, height: shown.length * 11 + 12, rx: 3, fill: "#f6efdb", stroke: "#cbb784", "stroke-width": 0.5 }));
  shown.forEach(([t, label], i) => {
    const y = y0 + i * 11;
    g.appendChild(svgEl("rect", { class: "legend-item", x: x0, y: y - 6, width: 8, height: 8, fill: landmarkFill(t) ?? WARD_TINT[t] ?? "#cbb18c", stroke: "#7a5a34", "stroke-width": 0.5 }));
    const txt = svgEl("text", { x: x0 + 12, y, "font-size": 7, fill: "#4a3a22" });
    txt.textContent = label;
    g.appendChild(txt);
  });
  root.appendChild(g);
}
