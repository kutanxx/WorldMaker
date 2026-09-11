import { svgEl } from "./renderer";

/**
 * The key, at the size it was drawn.
 *
 * Every legend on these maps lives INSIDE the map's own SVG, in map units, so what it measures on
 * screen is whatever the map is scaled to. ㉗ made the four views agree with the city plate at the
 * desktop's x0.993 — and nobody measured a phone. At 375px the world map is drawn at x0.321 and the
 * key comes out at 6.0px type, 5.5px rows, a 3.9px swatch: a 46x55 smudge that does not read as a
 * key at all, which is why the readable thing labelled "Key" was the chip beside it.
 *
 * Counter-scaling in place was measured and rejected: at x3.1 the key covers 34% of a 321x225 map,
 * and so does an HTML one built at the same legible size. There is no room on a phone's map for an
 * eight-row key at any size a person can read. So it comes off the map and stands under it, in its
 * own frame at one unit to one pixel — the SAME group the layers already drew, moved, not redrawn.
 * No second copy of the drawing code to drift from the first, and the export is untouched: it
 * renders its own SVG from scratch (app.ts) and never sees this.
 */

/** where a key was taken from, so it can be put back without anything being redrawn */
const home = new WeakMap<Element, { parent: Node; next: Node | null }>();

export function legendSheet(): SVGSVGElement {
  return svgEl("svg", { class: "legend-sheet", xmlns: "http://www.w3.org/2000/svg" }) as SVGSVGElement;
}

/**
 * Put the map's key where it belongs for this window width. Idempotent and authoritative: call it
 * after every render and after every year.
 *
 * ⚠ It must run again after `fillSlot`. In the political, culture and province views the key is
 * built by the layer INSIDE `.political-slot`, and scrubbing a year replaces that slot wholesale —
 * so every scrub hands back a brand new key while the sheet still holds the last one. Terrain is
 * the other case: its key is drawn once on the map root and nothing redraws it, so finding no key
 * on the map must not be read as "empty the sheet".
 */
export function placeLegend(map: SVGSVGElement, sheet: SVGSVGElement, outside: boolean, scale = 1): void {
  const fresh = map.querySelector(".legend");
  const held = sheet.firstElementChild;
  if (outside) {
    if (!fresh) return;            // the sheet already holds the only key there is
    if (held) held.remove();       // a redraw made a new one; the old one is stale
    home.set(fresh, { parent: fresh.parentNode as Node, next: fresh.nextSibling });
    sheet.appendChild(fresh);
    fitToKey(sheet, fresh, scale);
    return;
  }
  if (!held) return;
  if (fresh) { held.remove(); return; }  // the map drew itself a new key while we were away
  // `map.contains`, not `isConnected`: the question is whether the place it came from is still part
  // of THIS map — a slot `fillSlot` has since replaced is gone even though the document is fine, and
  // a map that has not been mounted yet is connected to nothing and is still perfectly good.
  const h = home.get(held);
  const stillThere = h !== undefined && map.contains(h.parent as Node);
  if (!stillThere) { map.appendChild(held); return; }
  const next = h.next !== null && h.next.parentNode === h.parent ? h.next : null;
  h.parent.insertBefore(held, next);
}

/**
 * The sheet takes the size of the cartouche the key is already sitting in — `legendPanel`'s outer
 * rect, the first rect under `.legend-panel`. That rect is the number the layer chose; `getBBox`
 * would be a guess about fonts, and jsdom does not implement it, so the tests could not hold this.
 *
 * `scale` is the drawing the key came from being handed back: the world map's key is drawn in
 * 17-unit rows because the map is drawn at about x1, the plate's in 11-unit rows because the plate
 * is drawn at x1.554 — both land on ㉗'s 17px row on a desktop. 1:1 would therefore be right for
 * one and 64% for the other, so the caller says which scale its key was drawn for. The viewBox is
 * untouched: those are the key's own coordinates either way.
 */
function fitToKey(sheet: SVGSVGElement, legend: Element, scale: number): void {
  const rect = legend.querySelector(".legend-panel rect");
  if (!rect) return;
  const n = (a: string) => Number(rect.getAttribute(a) ?? 0);
  const [x, y, w, h] = [n("x"), n("y"), n("width"), n("height")];
  sheet.setAttribute("viewBox", `${x} ${y} ${w} ${h}`);
  sheet.setAttribute("width", String(w * scale));
  sheet.setAttribute("height", String(h * scale));
}
