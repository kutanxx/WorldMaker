import { svgEl, INK, PARCHMENT } from "./renderer";
import { t, type Lang } from "./i18n";

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
// one scale for the map's distances and its areas (the gazetteer's km², engine/area.ts)
export { KM_PER_UNIT } from "../engine/area";
export const KM_PER_WALKING_DAY = 30;

/** The world map's bar, in map units: 360 km, twelve days on foot. A region's page measures its own again (regionPage.ts). */
export const WORLD_BAR_UNITS = 120;

/** How far `km` is on foot, as a bar's second line says it. */
export function walkCaption(km: number, lang: Lang): string {
  const days = km / KM_PER_WALKING_DAY;
  return days >= 1.5 ? t(lang, "walkDays").replace("{d}", String(Math.round(days))) : t(lang, "walkDay");
}

// Where a bar's words sit under its chain's foot `y`, all in shares of `type`: the chain's height, the
// caption's baseline under the chain, the second line's under that, and a descender's room under the last.
const CHAIN_H = 0.035, CAPTION = 0.075, SUB = 0.065, SUB_DROP = 0.085, DESCENDER = 0.3;
function barWords(type: number, sub: boolean): { h: number; caption: number; sub: number; depth: number } {
  const h = type * CHAIN_H;
  const caption = h * 0.6 + 6, subLine = caption + type * SUB_DROP;
  return { h, caption, sub: subLine, depth: sub ? subLine + type * SUB * DESCENDER : caption + type * CAPTION * DESCENDER };
}

/** How far under its chain's foot `y` a bar's tablet reaches: its words, and a descender's room under the last. */
export function scaleBarDepth(type: number, sub: boolean): number {
  return barWords(type, sub).depth;
}

/** air between a bar's tablet and the line it stands over */
export const BAR_AIR = 2;

/**
 * The `y` that stands a bar's tablet `BAR_AIR` above `line` — the frame's inner rule (`FRAME_INSET` in from
 * the map's edge), under which the frame's paper mat covers the map. The bar used to be anchored by its
 * chain at a round number from the edge, and its second line fell under the rule (design review 2026-10-15).
 */
export function scaleBarAbove(line: number, type: number, sub: boolean): number {
  return line - BAR_AIR - scaleBarDepth(type, sub);
}

/**
 * A bar of `units` map units, ticked in halves, captioned with what that distance is.
 *
 * Drawn in map units, so it grows with the zoom — which is what a scale bar is for: it says how far
 * the ground is, and the ground does not change when the reader leans in.
 *
 * `type` is the length its chain's height and its words are sized by: its own, unless it stands for
 * another bar — a region's page (regionPage.ts) measures the bar again, shorter, in the whole map's type.
 *
 * The tablet holds every word: it reaches `scaleBarDepth` under the chain's foot. (It used to stop short of
 * the last word's baseline — 3.7 units on the world map, where the days on foot hung off it over the sea.)
 */
export function scaleBar(x: number, y: number, units: number, caption: string, sub?: string, type = units, lang: Lang = "en"): SVGElement {
  const g = svgEl("g", { class: "scale-bar" });
  const words = barWords(type, !!sub);
  const h = words.h;
  g.appendChild(svgEl("rect", {
    x: x - 3, y: y - h - 11, width: units + 6, height: h + 11 + words.depth,
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
    class: "scale-bar-text", x: x + units / 2, y: y + words.caption,
    "text-anchor": "middle", "font-size": type * CAPTION, fill: INK,
  });
  label.textContent = caption;
  g.appendChild(label);
  if (sub) {
    // a note under the bar, in italic — where the face has one: Gowun Batang has none, and a slanted Hangul is
    // the browser's own smear (design review 2026-10-15, item 6), so the Korean line is upright
    const s = svgEl("text", {
      class: "scale-bar-sub", x: x + units / 2, y: y + words.sub,
      "text-anchor": "middle", "font-size": type * SUB, fill: "#6b5d42", ...(lang === "ko" ? {} : { "font-style": "italic" }),
    });
    s.textContent = sub;
    g.appendChild(s);
  }
  return g;
}

/**
 * Hold a scale bar's caption at a screen minimum — the bar is drawn in map units, and on a plate
 * drawn small its "270 m" came out 4.6px on a 390px phone and 4.2px in a 1280x600 laptop window.
 * The caption grows down from under the chain (its top stays clear of the chain), its tablet grows to
 * hold it — and then the whole bar moves UP by as much, so its foot stays where the drawing put it: the
 * bar stands over the frame's inner rule, under which the frame's paper mat covers the map, and grown
 * down its second line stood half under the frame at every desktop window and wholly below it on a
 * phone (design review 2026-10-15, item 2). A caption already big enough is left exactly as it was.
 * `drawnPx` is the drawing's width on screen; unmeasured (jsdom, not mounted), nothing changes.
 */
export function floorScaleCaption(svg: SVGSVGElement, minPx: number, drawnPx: number = svg.getBoundingClientRect().width): void {
  const vb = (svg.dataset.baseViewbox || svg.getAttribute("viewBox") || "").split(/[\s,]+/).map(Number);
  if (!(drawnPx > 0) || !(vb[2] > 0)) return;
  const pxPerUnit = drawnPx / vb[2];
  for (const g of svg.querySelectorAll(".scale-bar")) {
    const text = g.querySelector(".scale-bar-text");
    const back = g.querySelector("rect");            // the first rect is the tablet
    if (!text || !back) continue;
    const fs = Number(text.getAttribute("font-size"));
    if (!(fs > 0)) continue;
    const want = minPx / pxPerUnit;
    // ★ The world map's bar has a second line, the days on foot, smaller than the first: 6.8px at
    // 1440x900. It is held at the same minimum, and moves down by all the first line grew, so the gap
    // between them holds.
    const sub = g.querySelector(".scale-bar-sub");
    const sfs = Number(sub?.getAttribute("font-size"));
    const grow = Math.max(0, want - fs), subGrow = sub && sfs > 0 ? Math.max(0, want - sfs) : 0;
    if (!grow && !subGrow) continue;
    // the foot as the drawing put it — remembered the first time, since the page floors again at every relayout
    const foot = Number(g.getAttribute("data-foot") ?? (Number(back.getAttribute("y")) + Number(back.getAttribute("height"))));
    g.setAttribute("data-foot", String(foot));
    let bottom = Number(back.getAttribute("y")) + Number(back.getAttribute("height"));
    if (grow) {
      const baseline = Number(text.getAttribute("y")) + grow * 0.8;
      text.setAttribute("font-size", want.toFixed(2));
      text.setAttribute("y", baseline.toFixed(2));
      bottom = Math.max(bottom, baseline + want * 0.3);
    }
    if (sub && sfs > 0) {
      const size = sfs + subGrow, subBase = Number(sub.getAttribute("y")) + grow + subGrow * 0.8;
      if (subGrow) sub.setAttribute("font-size", size.toFixed(2));
      sub.setAttribute("y", subBase.toFixed(2));
      bottom = Math.max(bottom, subBase + size * 0.3);
    }
    back.setAttribute("height", (bottom - Number(back.getAttribute("y"))).toFixed(2));
    // ...and up by what it grew: the chain, the tablet and the words together
    const up = bottom - foot;
    if (up > 0) for (const el of g.querySelectorAll("[y]")) el.setAttribute("y", (Number(el.getAttribute("y")) - up).toFixed(2));
  }
}
