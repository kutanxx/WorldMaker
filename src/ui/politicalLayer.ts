import type { World } from "../types/world";
import { svgEl, legendPanel, INK, LEGEND_TITLE_H, LEGEND_TEXT, LEGEND_ROW, LEGEND_SWATCH, LEGEND_GAP, LEGEND_W_NAMED } from "./renderer";
import { cellPath, segPath } from "./svgPaths";
import { politicalBorders } from "../engine/borders";
import { nationColor, nationCentroids } from "./nationPalette";

type GridLike = Pick<World["grid"], "count" | "polygons" | "neighbors" | "points" | "width" | "height">;

export interface PoliticalOpts {
  fills?: boolean;
  labels?: boolean;
  legend?: boolean;
  legendTitle?: string; // what the swatches are a key to, already in the reader's language
  /**
   * What colour a realm is drawn in. Defaults to `nationColor`, which indexes the palette by id and
   * therefore draws id 12 exactly like id 0 — see `assignNationColors`, which is what a caller with
   * a whole history to look at should pass instead. The fills and the legend both read this one
   * function, so a swatch cannot disagree with the territory it is a key to.
   */
  colorOf?: (id: number) => string;
  /**
   * What a realm is CALLED on the drawing, given its id and the name the record holds. Defaults to
   * the recorded name.
   *
   * This layer is handed polities as `{id, name?}` and has no history and no language to look
   * anything up in, so a Korean map cannot be made by teaching it Korean — it is made by the caller
   * passing the labeller, exactly as it already passes `colorOf`. The id is in the signature
   * although Korean does not need it: a realm's form of government (kingdom / republic / empire)
   * lives in the history, is looked up by id, and reaches the map through this same seam.
   */
  labelOf?: (id: number, name: string) => string;
}

const MIN_LABEL_CELLS = 25;
const LEGEND_W = LEGEND_W_NAMED;

const FREE_COLOR = "#b7b1a4"; // neutral grey for independent free cities

export function politicalLayer(
  grid: GridLike,
  owner: ArrayLike<number>,
  polities: { id: number; name?: string; free?: boolean }[],
  opts: PoliticalOpts = {},
): SVGGElement {
  const g = svgEl("g", { class: "political" }) as SVGGElement;
  const recorded = new Map(polities.map((p) => [p.id, p.name]));
  const labelOf = opts.labelOf ?? ((_id: number, name: string) => name);
  // An unnamed realm stays unnamed: the labeller is asked only about names that exist, so it never
  // has to invent one and the `if (!name)` guards below still mean what they meant. `n` is checked
  // for TRUTH rather than for `undefined`, because `""` is also not a name to hand the labeller —
  // with a government form in hand, `labelOf(id, "")` can come back "왕국", a suffix with nothing to
  // attach to, which is truthy and would slip the guards below a bare label they exist to stop.
  const nameOf = (id: number): string | undefined => {
    const n = recorded.get(id);
    return n ? labelOf(id, n) : undefined;
  };
  const colorOf = opts.colorOf ?? nationColor;
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
        class: free ? "territory free-city" : "territory",
        "data-polity": id, d,
        fill: free ? FREE_COLOR : colorOf(id),
        "fill-opacity": free ? 0.72 : 0.58,
      }));
    }
  }

  g.appendChild(svgEl("path", {
    class: "border", d: segPath(politicalBorders(grid, owner)),
    fill: "none", stroke: "#3c2f1c", "stroke-width": opts.fills ? 1.5 : 1.2, "vector-effect": "non-scaling-stroke",
    "stroke-linejoin": "round",
  }));

  // free cities: a civic banner + name at each free polity's anchor, so an independent city reads
  // as a marked place rather than a subtle grey patch. Only over the political fills (terrain view
  // has no overlay), and pointer-events:none so it never blocks the city drilldown click.
  if (opts.fills && freeSet.size) {
    const anchors = nationCentroids(grid, owner);
    const fg = svgEl("g", { class: "free-city-markers", style: "pointer-events:none" });
    for (const id of freeSet) {
      const c = anchors.get(id);
      if (!c) continue;
      fg.appendChild(svgEl("circle", {
        class: "free-city-dot", cx: c.x, cy: c.y, r: 1.7, fill: FREE_COLOR, stroke: "#4a3f2c", "stroke-width": 0.7,
      }));
      fg.appendChild(svgEl("path", {
        class: "free-city-banner",
        d: `M${c.x.toFixed(1)},${(c.y - 1.7).toFixed(1)}L${c.x.toFixed(1)},${(c.y - 7).toFixed(1)}L${(c.x + 4).toFixed(1)},${(c.y - 6).toFixed(1)}L${c.x.toFixed(1)},${(c.y - 5).toFixed(1)}`,
        fill: "#efe7d2", stroke: "#4a3f2c", "stroke-width": 0.6, "stroke-linejoin": "round",
      }));
      const name = nameOf(id);
      if (name) {
        const tx = svgEl("text", {
          class: "free-city-label", x: c.x, y: c.y + 5.5, "text-anchor": "middle",
          "font-size": 6.5, fill: "#5a5346", "font-style": "italic",
          stroke: "#f3ead2", "stroke-width": 1.4, "paint-order": "stroke",
        });
        tx.textContent = name;
        fg.appendChild(tx);
      }
    }
    g.appendChild(fg);
  }

  if (opts.labels || opts.legend) {
    const centroids = nationCentroids(grid, owner);

    if (opts.labels) {
      const labels = svgEl("g", { class: "nation-labels" });
      for (const [id, c] of centroids) {
        if (c.cells < MIN_LABEL_CELLS) continue;
        const name = nameOf(id);
        if (!name) continue;
        const t = svgEl("text", {
          class: "nation-label", x: c.x, y: c.y, "text-anchor": "middle",
          "font-size": 11,
          fill: "#2a2118", stroke: "#f3ead2", "stroke-width": 2.5,
          "paint-order": "stroke", "stroke-linejoin": "round",
        });
        t.textContent = name;
        labels.appendChild(t);
      }
      g.appendChild(labels);
    }

    if (opts.legend) {
      const rows = [...centroids.entries()]
        .filter(([id]) => nameOf(id))
        .sort((a, b) => b[1].cells - a[1].cells)
        .slice(0, 10);
      const legend = svgEl("g", { class: "legend nation-legend" });
      // bottom-LEFT, matching the biome legend: only one legend is drawn per view, and the
      // bottom-right corner belongs to the zoom controls, which were sitting on top of this one.
      const x0 = 14;
      const y0 = grid.height - 14 - rows.length * LEGEND_ROW;
      legend.appendChild(legendPanel(x0 - 5, y0 - 10 - LEGEND_TITLE_H, LEGEND_W, rows.length * LEGEND_ROW + 14 + LEGEND_TITLE_H, opts.legendTitle));
      rows.forEach(([id], i) => {
        const y = y0 + i * LEGEND_ROW;
        legend.appendChild(svgEl("rect", {
          class: "legend-item", x: x0, y: y - 9, width: LEGEND_SWATCH, height: LEGEND_SWATCH,
          fill: colorOf(id), stroke: INK, "stroke-width": 0.6, "vector-effect": "non-scaling-stroke",
        }));
        const t = svgEl("text", { x: x0 + LEGEND_SWATCH + LEGEND_GAP, y, "font-size": LEGEND_TEXT, fill: "#42341f", "letter-spacing": 0.3 });
        t.textContent = nameOf(id) ?? "";
        legend.appendChild(t);
      });
      g.appendChild(legend);
    }
  }

  return g;
}
