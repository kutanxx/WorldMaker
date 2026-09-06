import { deconflictLabels } from "./deconflict";
import { applyLabelScale, applyMarkerScale } from "./labelScale";

// Everything the exported file is read at: one size, all at once. There is no zoom in a PNG, so
// nothing waits for one — every tier is in play, and a name only loses its place to another name.
const EVERY_TIER = Number.MAX_SAFE_INTEGER;

/**
 * Lay out the labels of a map that is about to be written to a file.
 *
 * `deconflictLabels` measures with `getBBox`, which needs real layout, and an exported map is built
 * by rendering a fresh SVG that was never in the document. So the pass found no layout, bailed
 * through its own guard, and every label went into the file — each one sitting on its neighbours.
 * The maps this project exists to produce were the least legible thing it made.
 *
 * The fix is the old trick: put the SVG in the document just long enough to be measured, off to one
 * side where nobody sees it, then take it back. It must be positioned away rather than hidden with
 * `display: none`, which would leave it with no layout and no getBBox all over again.
 */
export function layOutLabelsForExport(svg: SVGSVGElement): void {
  const vb = (svg.getAttribute("viewBox") || "0 0 1000 700").split(/[\s,]+/).map(Number);
  const holder = document.createElement("div");
  holder.setAttribute(
    "style",
    `position:absolute;left:-20000px;top:0;width:${vb[2] || 1000}px;height:${vb[3] || 700}px;`,
  );
  holder.appendChild(svg);
  document.body.appendChild(holder);
  try {
    // the sizes a reader sees when they lean in far enough to be shown these names at all
    applyLabelScale(svg, 1);
    applyMarkerScale(svg, 1);
    deconflictLabels(svg, EVERY_TIER);
  } finally {
    svg.remove();
    holder.remove();
  }
}
