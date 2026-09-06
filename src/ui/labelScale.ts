// Zoom on this map rewrites the viewBox, so everything drawn in it grows with the zoom — including
// the lettering. At 8x a region's name is eight times the size it was, which is why zooming in never
// showed MORE of the map's names: the text spread out exactly as fast as the land did, so no room
// was ever freed.
//
// A map application does the opposite. The lettering holds its size on screen while the land spreads
// out beneath it, and the space that opens up is what lets the smaller names — towns, streams —
// come in. This is the text counterpart of the `vector-effect: non-scaling-stroke` already on every
// line; SVG has no such property for font-size, so it is recomputed instead.
//
// Sizes are written as attributes rather than styles because the SVG and PNG exports carry no
// external CSS, and an export taken while zoomed should look like what the reader was looking at.

const SELECTOR = ".region-label, .city-label, .river-label, .nation-label, .province-label";

// A town's name was set at 8px so that a hundred of them could be crammed onto the resting map, and
// a river's at 10. They are not on the resting map any more — they wait for a zoom — so the reason
// to keep them that small is gone, and holding them there meant that a reader who zoomed in far
// enough to finally be shown one still could not read it. A name that arrives at its own zoom
// arrives at a size worth reading. Ordered: the first class that matches wins, so a capital is not
// read as a plain settlement.
const READER_SIZE: [string, number][] = [
  ["city-capital", 1.3],    // 10px -> 13
  ["city-town", 1.5],       //  8px -> 12
  ["river-label", 1.3],     // 10px -> 13
  ["province-label", 1.3],
];
// realm and region names are already set at the size the map wants them; they need no help
const readerSize = (el: Element) =>
  READER_SIZE.find(([cls]) => el.classList.contains(cls))?.[1] ?? 1;

// How fast the lettering grows as the reader zooms in. 0 would hold every name at a fixed size on
// screen — what a map application does, and at 8x it leaves the words looking detached from a land
// eight times their size. 1 would let them grow with the map, which is what this map used to do: a
// region's name eight times over, filling the view. Just under a half sits between the two, and the
// growth stops entirely past a point, so no amount of zooming turns a name into a banner.
const GROWTH = 0.45;
const MAX_GROWTH = 2.6;
const growth = (scale: number) => Math.min(Math.pow(scale, GROWTH), MAX_GROWTH);

/**
 * Hold every map label at the size it has on screen at zoom 1, whatever the zoom is now.
 * The size each label started at is remembered on the element, so this is safe to call repeatedly
 * and in any order of scales — it always works from the original, never from the last result.
 */
export function applyLabelScale(svg: SVGSVGElement, scale: number): void {
  if (!(scale > 0)) return;
  for (const el of svg.querySelectorAll<SVGGraphicsElement>(SELECTOR)) {
    const base = el.dataset.fs ?? el.getAttribute("font-size");
    if (base === null) continue;
    el.dataset.fs = base;
    const k = (readerSize(el) * growth(scale)) / scale;
    el.setAttribute("font-size", (Number(base) * k).toFixed(2));
    // the parchment halo behind the letters follows them exactly, or at 8x it swallows the word
    const hw = el.dataset.sw ?? el.getAttribute("stroke-width");
    if (hw !== null) {
      el.dataset.sw = hw;
      el.setAttribute("stroke-width", (Number(hw) * k).toFixed(2));
    }
  }
}

// A settlement's mark has to hold its size for the same reason its name does. Left alone, a town's
// dot grows with the zoom while the word beside it does not, and by 8x the map is a field of blobs
// with small labels next to them. Circles carry their own centre; the capital star and the free-port
// diamond are paths built around a point, so the renderer records that point for them.
const MARKS = ".marker-capital, .marker-town, .econ-zone, .econ-zone-halo, .province-seat, .free-city-dot";

export function applyMarkerScale(svg: SVGSVGElement, scale: number): void {
  if (!(scale > 0)) return;
  for (const el of svg.querySelectorAll<SVGGraphicsElement>(MARKS)) {
    const cx = el.getAttribute("cx") ?? el.dataset.cx;
    const cy = el.getAttribute("cy") ?? el.dataset.cy;
    if (cx === undefined || cy === undefined || cx === null || cy === null) continue;
    // About the mark's own point, so it changes size in place instead of sliding toward the origin,
    // and by the same law the lettering follows — a mark that held still while its name grew would
    // read as a pin dropped beside a word rather than as the settlement the word names.
    const k = growth(scale) / scale;
    el.setAttribute("transform", `translate(${cx},${cy}) scale(${k.toFixed(4)}) translate(${-Number(cx)},${-Number(cy)})`);
  }
}
