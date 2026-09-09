import { svgEl, INK, PARCHMENT } from "./renderer";

/**
 * How far a map unit is on the ground.
 *
 * There was no answer to this anywhere in the project, and an outside review wanted one: the maps
 * are for running a game at a table, where the first question about a plan is how long it takes to
 * walk across it. So the scale is STIPULATED here rather than derived — nothing upstream knows
 * about metres — and these are the two numbers that make the existing geometry read plausibly.
 *
 * A town's wall has a radius of 60 + 12*size, so a size-3 market town is 192 units across and a
 * size-6 capital 264. At three metres to the unit that is 580m and 790m, which is the size a walled
 * medieval town actually was. (The building lots do not survive the same test — a slum lot of 70
 * square units becomes 630 square metres, several times a real burgage plot. The generator's
 * proportions are not internally to scale, and distances were chosen over areas because distance is
 * the question a table asks.)
 *
 * The world is the same number a thousand times over: three kilometres to the unit puts a 1000-unit
 * continent at 3000km and leaves neighbouring towns a day or two apart on foot.
 */
export const METRES_PER_UNIT = 3;
export const KM_PER_UNIT = 3;
export const KM_PER_WALKING_DAY = 30;

/**
 * A bar of `units` map units, ticked in halves, captioned with what that distance is.
 *
 * Drawn in map units, so it grows with the zoom — which is what a scale bar is for: it says how far
 * the ground is, and the ground does not change when the reader leans in.
 */
export function scaleBar(x: number, y: number, units: number, caption: string, sub?: string): SVGElement {
  const g = svgEl("g", { class: "scale-bar" });
  const h = units * 0.035;
  g.appendChild(svgEl("rect", {
    x: x - 3, y: y - h - 11, width: units + 6, height: h + (sub ? 26 : 18),
    fill: PARCHMENT, "fill-opacity": 0.9, stroke: "none",
  }));
  // an alternating black-and-white chain, the way a printed map rules one
  for (let i = 0; i < 4; i++) {
    g.appendChild(svgEl("rect", {
      x: x + (units / 4) * i, y: y - h, width: units / 4, height: h,
      fill: i % 2 ? PARCHMENT : INK, stroke: INK, "stroke-width": 0.4, "vector-effect": "non-scaling-stroke",
    }));
  }
  const label = svgEl("text", {
    class: "scale-bar-text", x: x + units / 2, y: y + h * 0.6 + 6,
    "text-anchor": "middle", "font-size": units * 0.075, fill: INK,
  });
  label.textContent = caption;
  g.appendChild(label);
  if (sub) {
    const s = svgEl("text", {
      class: "scale-bar-sub", x: x + units / 2, y: y + h * 0.6 + 6 + units * 0.085,
      "text-anchor": "middle", "font-size": units * 0.065, fill: "#6b5d42", "font-style": "italic",
    });
    s.textContent = sub;
    g.appendChild(s);
  }
  return g;
}
