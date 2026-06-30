import { svgEl } from "./renderer";
import type { CityLayout } from "../engine/city";
import type { WardType } from "../engine/city/zoning";
import type { Polygon, Polyline } from "../engine/geometry";

const TINT: Partial<Record<WardType, string>> = {
  plaza: "#ece2c6", castle: "#ddd8cb", cathedral: "#e3dbe6", guildhall: "#dfe2d2",
  harbor: "#cfdde2", slum: "#e6dcc6", market: "#ece1c4",
};

function pts(poly: Polygon | Polyline): string {
  return poly.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
}
function avg(poly: Polygon): [number, number] {
  let x = 0, y = 0;
  for (const [px, py] of poly) { x += px; y += py; }
  return [x / poly.length, y / poly.length];
}

export function renderCity(layout: CityLayout): SVGSVGElement {
  const { w, h } = layout.bounds;
  const root = svgEl("svg", { width: "100%", viewBox: `0 0 ${w} ${h}`, class: "city" }) as SVGSVGElement;
  root.appendChild(svgEl("rect", { x: 0, y: 0, width: w, height: h, fill: "#f3efe4" }));

  const clipId = "cityclip";
  const defs = svgEl("defs", {});
  const clip = svgEl("clipPath", { id: clipId });
  clip.appendChild(svgEl("polygon", { points: pts(layout.boundary) }));
  defs.appendChild(clip);
  root.appendChild(defs);

  for (const body of layout.water.bodies) {
    root.appendChild(svgEl("polygon", { class: "water-shallow", points: pts(body), fill: "#bfd8e4" }));
    root.appendChild(svgEl("polygon", { class: "water", points: pts(body), fill: "#9fc1d6", transform: "scale(0.985)", "transform-origin": "150 150" }));
  }

  const clipped = svgEl("g", { "clip-path": `url(#${clipId})` });
  clipped.appendChild(svgEl("polygon", { class: "boundary", points: pts(layout.boundary), fill: "#efe7d2" }));
  for (const park of layout.parks) clipped.appendChild(svgEl("polygon", { class: "park", points: pts(park), fill: "#cfe0b8" }));
  for (const ward of layout.wards) {
    const tint = TINT[ward.type];
    if (tint) clipped.appendChild(svgEl("polygon", { class: "ward", points: pts(ward.polygon), fill: tint, "fill-opacity": 0.6 }));
  }

  const road = (cls: string, r: Polyline, stroke: string, wd: number) =>
    svgEl("polyline", { class: cls, points: pts(r), fill: "none", stroke, "stroke-width": wd, "stroke-linecap": "round", "stroke-linejoin": "round" });
  for (const r of layout.minorRoads) clipped.appendChild(road("road-minor-casing", r, "#c4b594", 2.6));
  for (const r of layout.mainRoads) clipped.appendChild(road("road-main-casing", r, "#a07c3e", 4.6));
  for (const r of layout.minorRoads) clipped.appendChild(road("road-minor", r, "#f8f3e6", 1.4));
  for (const r of layout.mainRoads) clipped.appendChild(road("road-main", r, "#d8b65e", 3));

  for (const ward of layout.wards) {
    const fill = ward.type === "castle" ? "#cfcabe" : ward.type === "cathedral" ? "#ddd2e0" : "#e6dcc8";
    for (const b of ward.buildings) clipped.appendChild(svgEl("polygon", { class: "building", points: pts(b), fill, stroke: "#9a8a70", "stroke-width": 0.4 }));
  }
  root.appendChild(clipped);

  for (const [a, b] of layout.water.bridges) {
    root.appendChild(svgEl("line", { class: "bridge", x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: "#7a6a52", "stroke-width": 4, "stroke-linecap": "round" }));
  }

  if (layout.moat) for (const s of layout.moat) {
    root.appendChild(svgEl("polyline", { class: "moat", points: pts(s), fill: "none", stroke: "#bcd6e0", "stroke-width": 5, "stroke-opacity": 0.85 }));
  }

  if (layout.wall) {
    for (const s of layout.wall.segments) {
      root.appendChild(svgEl("polyline", { class: "wall-seg", points: pts(s), fill: "none", stroke: "#43392d", "stroke-width": 4, "stroke-linejoin": "round", "stroke-linecap": "round" }));
      root.appendChild(svgEl("polyline", { class: "wall-seg-inner", points: pts(s), fill: "none", stroke: "#8a7a60", "stroke-width": 1, "stroke-linejoin": "round" }));
    }
    const tg = svgEl("g", { class: "towers" });
    for (const t of layout.wall.towers) tg.appendChild(svgEl("circle", { class: "tower", cx: t[0], cy: t[1], r: 2.6, fill: "#8a7858", stroke: "#5a4a36", "stroke-width": 0.8 }));
    root.appendChild(tg);
    const gg = svgEl("g", { class: "gates" });
    for (const ga of layout.wall.gates) gg.appendChild(svgEl("rect", { class: "gate", x: ga[0] - 3, y: ga[1] - 3, width: 6, height: 6, rx: 1, fill: "#9a9a9a", stroke: "#43392d", "stroke-width": 1 }));
    root.appendChild(gg);
  }

  for (const ward of layout.wards) {
    if (ward.type === "cathedral") {
      const c = avg(ward.polygon);
      root.appendChild(svgEl("path", { class: "landmark", d: `M${c[0]} ${c[1] - 7} v14 M${c[0] - 4} ${c[1] - 2} h8`, stroke: "#7a5a86", "stroke-width": 2, fill: "none" }));
    }
  }

  const labelsG = svgEl("g", { class: "labels" });
  for (const l of layout.labels) {
    const halo = svgEl("text", { x: l.x, y: l.y, "font-size": 7, fill: "#f3efe4", stroke: "#f3efe4", "stroke-width": 2.5, "text-anchor": "middle" });
    halo.textContent = l.text;
    labelsG.appendChild(halo);
    const t = svgEl("text", { x: l.x, y: l.y, "font-size": 7, fill: "#4a3f2c", "text-anchor": "middle" });
    t.textContent = l.text;
    labelsG.appendChild(t);
  }
  root.appendChild(labelsG);

  const title = svgEl("text", { x: w / 2, y: 14, "font-size": 13, fill: "#3a2f1c", "text-anchor": "middle" });
  title.textContent = layout.name;
  root.appendChild(title);

  const legend = svgEl("g", { class: "legend" });
  const items: [string, string][] = [["#9fc1d6", "Water"], ["#cfe0b8", "Park"], ["#d8b65e", "Main road"], ["#e6dcc8", "Buildings"]];
  const x0 = 6, y0 = h - 8 - items.length * 11;
  legend.appendChild(svgEl("rect", { x: x0 - 4, y: y0 - 8, width: 86, height: items.length * 11 + 12, rx: 3, fill: "#f7f2e6", stroke: "#cbb784", "stroke-width": 0.5 }));
  items.forEach(([color, label], i) => {
    const y = y0 + i * 11;
    legend.appendChild(svgEl("rect", { class: "legend-item", x: x0, y: y - 6, width: 8, height: 8, fill: color, stroke: "#9a8a70", "stroke-width": 0.4 }));
    const txt = svgEl("text", { x: x0 + 12, y, "font-size": 7, fill: "#4a3f2c" });
    txt.textContent = label;
    legend.appendChild(txt);
  });
  root.appendChild(legend);

  return root;
}
