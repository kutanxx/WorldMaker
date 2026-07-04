import { svgEl } from "./renderer";
import type { CityLayout } from "../engine/city";
import type { WardType } from "../engine/city/zoning";
import type { Polygon, Polyline } from "../engine/geometry";
import { type Lang, WARD_NAME, t } from "./i18n";

// A distinct (but parchment-muted) colour per district so the wards read apart — each
// functional zone gets its own hue. harbor stays untinted (its docks are the waterfront
// wharves/piers). Buildings are filled with the same hue so a whole district reads as its colour.
const TINT: Partial<Record<WardType, string>> = {
  plaza: "#e6ddc6",      // civic square — light stone
  market: "#e9cd8a",     // commerce — warm gold
  guildhall: "#bfcfa2",  // guilds — sage green
  cathedral: "#d7c4e2",  // religious — lilac
  castle: "#bcc4d2",     // power — cool blue-grey stone
  merchant: "#e6bd97",   // wealthy trade — peach
  patriciate: "#dfb1b1", // elite — dusty rose
  craftsmen: "#d9c191",  // artisans — tan
  slum: "#c6bbaa",       // poor — drab grey-brown
  military: "#cfa898",   // garrison — muted red-brown
  park: "#b8d29a",       // green space
};

function pts(poly: Polygon | Polyline): string {
  return poly.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
}
function avg(poly: Polygon): [number, number] {
  let x = 0, y = 0;
  for (const [px, py] of poly) { x += px; y += py; }
  return [x / poly.length, y / poly.length];
}

export function renderCity(layout: CityLayout, lang: Lang = "en"): SVGSVGElement {
  const { w, h } = layout.bounds;
  const LEGW = 108; // right-hand strip that holds the district key, OUTSIDE the map so it never covers the city
  const root = svgEl("svg", { width: "100%", viewBox: `0 0 ${w + LEGW} ${h}`, class: "city" }) as SVGSVGElement;
  root.appendChild(svgEl("rect", { x: 0, y: 0, width: w + LEGW, height: h, fill: "#f3efe4" }));

  const clipId = "cityclip";
  const defs = svgEl("defs", {});
  const clip = svgEl("clipPath", { id: clipId });
  clip.appendChild(svgEl("polygon", { points: pts(layout.boundary) }));
  defs.appendChild(clip);
  root.appendChild(defs);

  for (const body of layout.water.bodies) {
    root.appendChild(svgEl("polygon", { class: "water-shallow", points: pts(body), fill: "#bfd8e4" }));
    root.appendChild(svgEl("polygon", { class: "water", points: pts(body), fill: "#9fc1d6", transform: "scale(0.985)", "transform-origin": `${w / 2} ${h / 2}` }));
  }

  // harbor: breakwater/mole + lighthouse + piers + moored boats (on the sea)
  if (layout.harbor) {
    const hb = layout.harbor;
    const hg = svgEl("g", { class: "harbor" });
    if (hb.quay.length >= 2) {
      hg.appendChild(svgEl("polyline", { class: "quay", points: pts(hb.quay), fill: "none", stroke: "#b8a988", "stroke-width": 2.4, "stroke-linecap": "round", "stroke-linejoin": "round" }));
    }
    // warehouse blocks lining the quay — the visible docks, protruding at the waterfront
    for (const wf of hb.wharves) {
      hg.appendChild(svgEl("polygon", { class: "wharf", points: pts(wf), fill: "#a9895f", stroke: "#5c4326", "stroke-width": 0.5 }));
    }
    hg.appendChild(svgEl("polyline", { class: "breakwater", points: pts(hb.breakwater), fill: "none", stroke: "#9a8f7a", "stroke-width": 3, "stroke-linecap": "round", "stroke-linejoin": "round" }));
    for (const p of hb.piers) {
      hg.appendChild(svgEl("polyline", { class: "pier", points: pts(p), fill: "none", stroke: "#8a6a44", "stroke-width": 1.4, "stroke-linecap": "round" }));
    }
    for (const b of hb.boats) {
      const c = Math.cos(b.angle), s = Math.sin(b.angle);
      const bow: [number, number] = [b.at[0] + c * 2.5, b.at[1] + s * 2.5];
      const sl: [number, number] = [b.at[0] - c * 1.5 - s * 1.2, b.at[1] - s * 1.5 + c * 1.2];
      const sr: [number, number] = [b.at[0] - c * 1.5 + s * 1.2, b.at[1] - s * 1.5 - c * 1.2];
      hg.appendChild(svgEl("polygon", { class: "boat", points: pts([bow, sl, sr]), fill: "#7a5a3a", stroke: "#3c2f1c", "stroke-width": 0.3 }));
    }
    const [lx, ly] = hb.lighthouse;
    hg.appendChild(svgEl("circle", { class: "lighthouse", cx: lx, cy: ly, r: 1.8, fill: "#efe7d2", stroke: "#7a2f2f", "stroke-width": 0.8 }));
    hg.appendChild(svgEl("circle", { class: "beacon", cx: lx, cy: ly, r: 0.7, fill: "#e0a83a" }));
    root.appendChild(hg);
  }

  // mountain barriers: rock fill + cliff crest + downhill hachures (unclipped, behind the city)
  if (layout.mountains.length) {
    const mg = svgEl("g", { class: "mountains" });
    for (const m of layout.mountains) {
      const crest = m.steep ? "#5f5648" : "#7a715f";
      mg.appendChild(svgEl("polygon", { class: "mountain", points: pts(m.polygon), fill: m.steep ? "#a99e8c" : "#bcb2a0", stroke: "none" }));
      mg.appendChild(svgEl("polyline", { class: "cliff", points: pts(m.innerEdge), fill: "none", stroke: crest, "stroke-width": m.steep ? 1.4 : 0.9, "stroke-linejoin": "round" }));
      const step = m.steep ? 1 : 2, len = m.steep ? 5 : 3.5;
      for (let i = 0; i < m.innerEdge.length; i += step) {
        const p = m.innerEdge[i];
        const dx = p[0] - w / 2, dy = p[1] - h / 2, L = Math.hypot(dx, dy) || 1;
        const sx = p[0] + (dx / L) * len, sy = p[1] + (dy / L) * len; // start out in the mass, point downhill to the crest
        mg.appendChild(svgEl("line", { class: "hachure", x1: sx.toFixed(1), y1: sy.toFixed(1), x2: p[0].toFixed(1), y2: p[1].toFixed(1), stroke: crest, "stroke-width": 0.5 }));
      }
    }
    root.appendChild(mg);
  }

  const env = svgEl("g", { class: "environs" });
  // countryside ground patches: gardens/fields/pastures/orchards/woods, drawn under the
  // suburb roads/houses so buildings and roads read on top of the open-field system.
  const cs = layout.countryside;
  for (const g2 of cs.gardens) env.appendChild(svgEl("polygon", { class: "garden", points: pts(g2), fill: "#c9d0a0", stroke: "#8a8a5f", "stroke-width": 0.3 }));
  const dry = cs.dry; // engine is the single source of truth for the desert palette
  for (const f of cs.fields) {
    // fallow fields (three-field rotation) rest under grass; the ridge-and-furrow earthwork
    // persists so the furrows stay, just lighter.
    const fallow = f.state === "fallow";
    const fill = fallow ? "#c8cba0" : dry ? "#e0cf9a" : "#d9cc9a";
    const furrow = fallow ? "#b3b585" : dry ? "#c9b47a" : "#c4b581";
    env.appendChild(svgEl("polygon", { class: fallow ? "field field-fallow" : "field", points: pts(f.polygon), fill, stroke: "#b3a26e", "stroke-width": 0.4 }));
    for (const s of f.strips) env.appendChild(svgEl("polyline", { class: "furrow", points: pts(s), fill: "none", stroke: furrow, "stroke-width": 0.35 }));
  }
  for (const p of cs.pastures) {
    env.appendChild(svgEl("polygon", { class: "pasture", points: pts(p.fence), fill: "#ccd6a8", "fill-opacity": 0.7, stroke: "#8a6a44", "stroke-width": 0.5, "stroke-dasharray": "1.6 1.1" }));
    for (const a of p.animals) env.appendChild(svgEl("circle", { class: "animal", cx: a[0], cy: a[1], r: 0.8, fill: p.kind === "sheep" ? "#f4f1e4" : "#8a6a44", stroke: "#5c4a33", "stroke-width": 0.25 }));
  }
  for (const or of cs.orchards) {
    env.appendChild(svgEl("polygon", { class: "orchard", points: pts(or.polygon), fill: "#cfd8ac", "fill-opacity": 0.5, stroke: "#8a8a5f", "stroke-width": 0.3 }));
    for (const t2 of or.trees) {
      env.appendChild(svgEl("circle", { class: "orchard-tree", cx: t2[0], cy: t2[1], r: 1.4, fill: "#8fae6e", stroke: "#5d7a45", "stroke-width": 0.3 }));
    }
  }
  for (const t2 of cs.woods) {
    env.appendChild(svgEl("circle", { class: "wood-tree", cx: t2[0], cy: t2[1], r: 1.6 + ((t2[0] * 7 + t2[1] * 13) % 10) / 12, fill: "#7d9b62", stroke: "#55703f", "stroke-width": 0.3 }));
  }
  for (const r of layout.suburbRoads) {
    env.appendChild(svgEl("polyline", { class: "suburb-road", points: pts(r), fill: "none", stroke: "#c9bb96", "stroke-width": 1.6, "stroke-linecap": "round" }));
  }
  for (const b of layout.suburbs) {
    env.appendChild(svgEl("polygon", { class: "suburb", points: pts(b), fill: "#e0d6c0", stroke: "#9a8a70", "stroke-width": 0.4 }));
  }
  // farm buildings: drawn above their fields/pastures, alongside the suburb houses
  for (const fm of cs.farmsteads) {
    if (fm.yard) env.appendChild(svgEl("polygon", { class: "farm-yard", points: pts(fm.yard), fill: "none", stroke: "#8a6a44", "stroke-width": 0.4, "stroke-dasharray": "1.2 1" }));
    env.appendChild(svgEl("polygon", { class: "farm-barn", points: pts(fm.barn), fill: "#7a5a3a", stroke: "#4d3620", "stroke-width": 0.4 }));
    env.appendChild(svgEl("polygon", { class: "farm-house", points: pts(fm.house), fill: "#e0d6c0", stroke: "#9a8a70", "stroke-width": 0.4 }));
  }
  for (const o of layout.outworks) {
    const [x, y] = o.at;
    if (o.type === "windmill") {
      env.appendChild(svgEl("circle", { class: "outwork", cx: x, cy: y, r: 1.6, fill: "#8a7858" }));
      const c = Math.cos(o.angle), s = Math.sin(o.angle), r = 4;
      env.appendChild(svgEl("path", { class: "outwork-sails", d: `M${(x - c * r).toFixed(1)} ${(y - s * r).toFixed(1)} L${(x + c * r).toFixed(1)} ${(y + s * r).toFixed(1)} M${(x + s * r).toFixed(1)} ${(y - c * r).toFixed(1)} L${(x - s * r).toFixed(1)} ${(y + c * r).toFixed(1)}`, stroke: "#6b5a44", "stroke-width": 0.8, fill: "none" }));
    } else {
      env.appendChild(svgEl("rect", { class: "outwork", x: x - 2.5, y: y - 2, width: 5, height: 4, fill: "#c9a86a", stroke: "#8a6a44", "stroke-width": 0.5 }));
      env.appendChild(svgEl("circle", { class: "outwork-wheel", cx: x + 3, cy: y + 1, r: 2, fill: "none", stroke: "#6b5a44", "stroke-width": 0.7 }));
    }
  }
  // extramural landmarks (outside the walls)
  if (layout.abbey) {
    const [ax, ay] = layout.abbey.at;
    const ag = svgEl("g", { class: "abbey", transform: `rotate(${((layout.abbey.angle * 180) / Math.PI).toFixed(1)} ${ax} ${ay})` });
    ag.appendChild(svgEl("rect", { class: "cloister", x: ax - 6, y: ay - 6, width: 12, height: 12, rx: 0.5, fill: "#d8d2c4", stroke: "#8a7f6a", "stroke-width": 0.6 }));
    ag.appendChild(svgEl("rect", { class: "garth", x: ax - 2.5, y: ay - 2.5, width: 5, height: 5, fill: "#bcd0a0", stroke: "#8a7f6a", "stroke-width": 0.3 }));
    ag.appendChild(svgEl("path", { class: "church", d: `M${ax},${ay - 6}L${ax},${ay - 11}M${ax - 2},${ay - 9}L${ax + 2},${ay - 9}`, fill: "none", stroke: "#3c2f1c", "stroke-width": 1, "stroke-linecap": "round" }));
    env.appendChild(ag);
  }
  if (layout.cemetery) {
    const cg = svgEl("g", { class: "cemetery" });
    const [cx, cy] = layout.cemetery.at;
    cg.appendChild(svgEl("rect", { class: "churchyard", x: cx - 6, y: cy - 6.5, width: 12, height: 13, rx: 1, fill: "#e4dfcd", stroke: "#9a8a70", "stroke-width": 0.4 }));
    for (const [gx, gy] of layout.cemetery.graves) {
      cg.appendChild(svgEl("rect", { class: "grave", x: gx - 0.8, y: gy - 1.3, width: 1.6, height: 2.6, rx: 0.7, fill: "#cfc8b8", stroke: "#7a715f", "stroke-width": 0.3 }));
    }
    env.appendChild(cg);
  }
  if (layout.gallows) {
    const [gx, gy] = layout.gallows;
    env.appendChild(svgEl("path", { class: "gallows", d: `M${gx},${gy + 4}L${gx},${gy - 6}L${gx + 5},${gy - 6}M${gx + 5},${gy - 6}L${gx + 5},${gy - 3}`, fill: "none", stroke: "#3c2f1c", "stroke-width": 0.9, "stroke-linecap": "round" }));
  }
  root.appendChild(env);

  const clipped = svgEl("g", { "clip-path": `url(#${clipId})` });
  clipped.appendChild(svgEl("polygon", { class: "boundary", points: pts(layout.boundary), fill: layout.features.groundColor }));
  for (const park of layout.parks) clipped.appendChild(svgEl("polygon", { class: "park", points: pts(park), fill: "#cfe0b8" }));
  for (const ward of layout.wards) {
    const tint = TINT[ward.type];
    if (tint) clipped.appendChild(svgEl("polygon", { class: "ward", points: pts(ward.polygon), fill: tint, "fill-opacity": 0.7 }));
  }

  const road = (cls: string, r: Polyline, stroke: string, wd: number) =>
    svgEl("polyline", { class: cls, points: pts(r), fill: "none", stroke, "stroke-width": wd, "stroke-linecap": "round", "stroke-linejoin": "round" });
  for (const r of layout.minorRoads) clipped.appendChild(road("road-minor-casing", r, "#c4b594", 2.6));
  for (const r of layout.mainRoads) clipped.appendChild(road("road-main-casing", r, "#a07c3e", 4.6));
  for (const r of layout.minorRoads) clipped.appendChild(road("road-minor", r, "#f8f3e6", 1.4));
  for (const r of layout.mainRoads) clipped.appendChild(road("road-main", r, "#d8b65e", 3));

  for (const ward of layout.wards) {
    // colour the buildings by their district so the whole zone reads as its hue (otherwise
    // cream buildings cover the ground tint and the districts blur together)
    const fill = TINT[ward.type] ?? "#e6dcc8";
    for (const b of ward.buildings) clipped.appendChild(svgEl("polygon", { class: "building", points: pts(b), fill, stroke: "#8a7a60", "stroke-width": 0.4 }));
  }

  // the lord's castle: inner enceinte + towers + gate/postern + keep + annexes, drawn over
  // the castle ward's buildings (there are none — NO_BUILDINGS skips it) so it reads as the citadel.
  if (layout.castle) {
    const ca = layout.castle;
    const cg = svgEl("g", { class: "castle-inner" });
    for (const an of ca.annexes) cg.appendChild(svgEl("polygon", { class: "castle-annex", points: pts(an), fill: "#cfd4dd", stroke: "#5a6272", "stroke-width": 0.4 }));
    cg.appendChild(svgEl("polygon", { class: "castle-wall", points: pts(ca.innerWall), fill: "none", stroke: "#5a5346", "stroke-width": 1.3, "stroke-linejoin": "round" }));
    for (const t2 of ca.towers) cg.appendChild(svgEl("circle", { class: "castle-tower", cx: t2[0], cy: t2[1], r: 1.3, fill: "#8a8272", stroke: "#4c463c", "stroke-width": 0.4 }));
    cg.appendChild(svgEl("circle", { class: "castle-gate", cx: ca.gate[0], cy: ca.gate[1], r: 1.1, fill: "#e8dfc9", stroke: "#4c463c", "stroke-width": 0.5 }));
    if (ca.postern) cg.appendChild(svgEl("circle", { class: "castle-postern", cx: ca.postern[0], cy: ca.postern[1], r: 0.9, fill: "#e8dfc9", stroke: "#7a2f2f", "stroke-width": 0.5 }));
    cg.appendChild(svgEl("polygon", { class: "castle-keep", points: pts(ca.keep), fill: "#6e7686", stroke: "#3a4050", "stroke-width": 0.6 }));
    clipped.appendChild(cg);
  }
  root.appendChild(clipped);

  if (layout.features.trees.length) {
    const treesG = svgEl("g", { class: "trees", "clip-path": `url(#${clipId})` });
    for (const [x, y] of layout.features.trees) {
      treesG.appendChild(svgEl("circle", { class: "tree", cx: x, cy: y, r: 2.2, fill: "#6f9457", stroke: "#4c6b3c", "stroke-width": 0.4 }));
    }
    root.appendChild(treesG);
  }

  if (layout.features.oasis) {
    const { center: oc, radius: orr } = layout.features.oasis;
    const og = svgEl("g", { class: "oasis-palms", "clip-path": `url(#${clipId})` });
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      const px = oc[0] + Math.cos(a) * orr * 1.15, py = oc[1] + Math.sin(a) * orr * 1.15;
      og.appendChild(svgEl("path", { class: "palm", d: `M${px} ${py} l -2.5 -4 M${px} ${py} l 2.5 -4 M${px} ${py} l 0 -5`, stroke: "#5c8a4a", "stroke-width": 1, fill: "none", "stroke-linecap": "round" }));
    }
    root.appendChild(og);
  }

  if (layout.features.onStilts) {
    const sg = svgEl("g", { class: "stilts", "clip-path": `url(#${clipId})` });
    for (const ward of layout.wards) for (const b of ward.buildings) {
      const c = avg(b);
      sg.appendChild(svgEl("line", { class: "stilt", x1: c[0], y1: c[1] + 1, x2: c[0], y2: c[1] + 4.5, stroke: "#6b5a44", "stroke-width": 0.8, "stroke-linecap": "round" }));
    }
    root.appendChild(sg);
  }

  for (const [a, b] of layout.water.bridges) {
    root.appendChild(svgEl("line", { class: "bridge", x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: "#7a6a52", "stroke-width": 4, "stroke-linecap": "round" }));
  }

  if (layout.moat) for (const s of layout.moat) {
    root.appendChild(svgEl("polyline", { class: "moat", points: pts(s), fill: "none", stroke: "#bcd6e0", "stroke-width": 5, "stroke-opacity": 0.85 }));
  }
  // causeways across the moat in front of each gate (drawn over the water)
  for (const [a, b] of layout.gateBridges) {
    root.appendChild(svgEl("line", { class: "gate-bridge", x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: "#c2b189", "stroke-width": 6, "stroke-linecap": "round" }));
    root.appendChild(svgEl("line", { class: "gate-bridge-top", x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: "#e6dcc8", "stroke-width": 2.6, "stroke-linecap": "round" }));
  }

  if (layout.wall) {
    const wallStroke = layout.features.wallMaterial === "timber" ? "#6b4f34" : "#43392d";
    const wallInner = layout.features.wallMaterial === "timber" ? "#8a6a44" : "#8a7a60";
    for (const s of layout.wall.segments) {
      root.appendChild(svgEl("polyline", { class: "wall-seg", points: pts(s), fill: "none", stroke: wallStroke, "stroke-width": 4, "stroke-linejoin": "round", "stroke-linecap": "round" }));
      root.appendChild(svgEl("polyline", { class: "wall-seg-inner", points: pts(s), fill: "none", stroke: wallInner, "stroke-width": 1, "stroke-linejoin": "round" }));
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
    const text = WARD_NAME[lang][l.type] ?? "";
    const halo = svgEl("text", { x: l.x, y: l.y, "font-size": 7, fill: "#f3efe4", stroke: "#f3efe4", "stroke-width": 2.5, "text-anchor": "middle" });
    halo.textContent = text;
    labelsG.appendChild(halo);
    const tx = svgEl("text", { x: l.x, y: l.y, "font-size": 7, fill: "#4a3f2c", "text-anchor": "middle" });
    tx.textContent = text;
    labelsG.appendChild(tx);
  }
  root.appendChild(labelsG);

  const title = svgEl("text", { x: w / 2, y: 14, "font-size": 13, fill: "#3a2f1c", "text-anchor": "middle" });
  title.textContent = layout.name;
  root.appendChild(title);

  const legend = svgEl("g", { class: "legend" });
  // a district key: the present ward types (in functional order) + a couple of base features,
  // so the reader can tell the colour-coded quarters apart
  const order: WardType[] = ["plaza", "market", "guildhall", "cathedral", "castle", "merchant", "patriciate", "craftsmen", "slum", "military", "park"];
  const present = order.filter((wt) => TINT[wt] && layout.wards.some((wd) => wd.type === wt));
  const items: [string, string][] = [
    ...present.map((wt) => [TINT[wt]!, WARD_NAME[lang][wt] ?? ""] as [string, string]),
    ["#9fc1d6", t(lang, "water")], ["#d8b65e", t(lang, "mainRoad")],
  ];
  const x0 = w + 12, y0 = 20; // in the right-hand strip, clear of the map
  legend.appendChild(svgEl("rect", { x: x0 - 4, y: y0 - 8, width: 92, height: items.length * 11 + 12, rx: 3, fill: "#f7f2e6", stroke: "#cbb784", "stroke-width": 0.5 }));
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
