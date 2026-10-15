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

/**
 * How far in from its panel the key stands: the fold head's own horizontal padding (`.fold-head`,
 * theme.css — a test holds the two together), so the swatches start under the heading's words and
 * the town names, not 6px to the left of them as they did.
 */
export const KEY_INSET = 6;
/** between two columns, in CSS pixels */
const COL_GAP = 12;
/** extra room between rows when the key stands in two columns, in CSS pixels */
const KEY_AIR = 5;

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
/**
 * Leave to draw the key SMALLER than `scale` so that two columns fit the room, down to `minScale` —
 * a town plate's 30-row key beside a desktop's plate (see `fitToKey`). Without it a key that two
 * columns would overflow keeps one column at its scale.
 */
export interface KeyFit {
  minScale: number;
  /**
   * The room's HEIGHT in CSS pixels, where the caller can measure it: the key is drawn smaller until two
   * columns stand in it, down to `minScale`, and a key that cannot is fitted beside the scrollbar it will
   * have. 0 (or unset) where there is no such room — a stacked panel that scrolls as a page, jsdom. Fitted
   * to the width alone, a 32-row key stood 249px tall in a fold with 427px of room and still got a
   * scrollbar for it on alternate opens (user report, 2026-10-15 — see `fitToKey`).
   */
  roomH?: number;
  /** what a scrollbar takes from the room's width, in CSS pixels (`scrollbarWidth`), for a key that must scroll */
  gutter?: number;
}

/**
 * The width a scrollbar takes from the box it stands in, on this platform: 15-17px of a Windows window,
 * nought where scrollbars are overlaid (a Mac's, a phone's). Measured on a throwaway box, so it is
 * known BEFORE the key that will need one is drawn; 0 without layout (jsdom).
 */
export function scrollbarWidth(): number {
  const probe = document.createElement("div");
  probe.style.cssText = "position:absolute;top:-9999px;left:-9999px;width:100px;height:100px;overflow:scroll;visibility:hidden";
  document.body.appendChild(probe);
  const w = probe.offsetWidth - probe.clientWidth;
  probe.remove();
  return w > 0 ? w : 0;
}

export function placeLegend(
  map: SVGSVGElement, sheet: SVGSVGElement, outside: boolean, scale = 1,
  // two on a phone, where the key stands under the map with most of 336px beside it; one where it
  // stands in the 210px column beside a desktop's map, which two would overflow
  columns = 1,
  fit?: KeyFit,
): void {
  const fresh = map.querySelector(".legend");
  const held = sheet.firstElementChild;
  if (outside) {
    // the sheet already holds the only key there is — but fit it again: it may have been fitted
    // while its fold was closed (no layout, every word 0 wide), or for the other side of the
    // narrow line. Opened on a phone after a folded fit, five realm names ran into the second column.
    if (!fresh) { if (held) fitToKey(sheet, held, scale, columns, fit); return; }
    if (held) held.remove();       // a redraw made a new one; the old one is stale
    home.set(fresh, { parent: fresh.parentNode as Node, next: fresh.nextSibling });
    sheet.appendChild(fresh);
    fitToKey(sheet, fresh, scale, columns, fit);
    return;
  }
  if (!held) return;
  // back on the map it is the map's key again: one column, as the layer drew it
  for (const r of held.querySelectorAll(".legend-row")) r.removeAttribute("transform");
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
function fitToKey(sheet: SVGSVGElement, legend: Element, scale: number, columns = 1, fit?: KeyFit): void {
  const panel = legend.querySelector(".legend-panel");
  const rect = panel?.querySelector("rect");
  if (!rect) return;
  const n = (a: string) => Number(rect.getAttribute(a) ?? 0);
  const [x, y, w, h] = [n("x"), n("y"), n("width"), n("height")];
  // ★ Crop to the KEY, not to the cartouche. On the map the key wears a double rule, corner dots
  // and a Cinzel heading — the map's own furniture. Off it, the page has already drawn a panel and
  // written the heading on the fold, so what is left to show is the swatches: measured, the framed
  // version sat 112 units wide inside a 210px panel with a second heading above its own, which is a
  // frame inside a frame. `data-band` is the heading's height, written where the heading is placed;
  // INSET is the double rule's own margin (3 units) plus a unit of air.
  const band = Number(panel?.getAttribute("data-band") ?? 0);
  const INSET = 4;
  // the band already includes the heading's own air, so the top is cropped by it alone: at 12-unit
  // type that lands one unit above the first swatch (measured: the swatch sat 3 units ABOVE the
  // viewport and was clipped when the inset was applied twice).
  let [vx, vy, vw, vh] = [x + INSET, y + band, w - INSET * 2, h - band - INSET];
  // ★ Two columns: the second half of the rows moves up beside the first, by exactly the room the
  // layer gave each row. Measured on a 390x844 phone, the one-column terrain key was 104 units of a
  // 336px panel, 146 tall — two thirds of its width empty. Column-major, the way a printed key reads
  // (down, then across), and the first column takes an odd row. Three rows or fewer stay one column:
  // two short columns read as a table, not a key.
  const rows = [...legend.querySelectorAll<SVGElement>(".legend-row")];
  const pitch = Number(rows[0]?.getAttribute("data-pitch") ?? 0);
  // ★ A column is as wide as its widest word. The sheet clips (an inline svg is `overflow: hidden`)
  // and the cartouche's width was chosen before the names were known: measured on a phone, five of
  // eight realm names ran 6-20 units past it and lost their last syllable, in one column as much as
  // in two. getBBox is the browser's own measure of the word; without layout (jsdom, or a sheet not
  // yet in the page) the cartouche's width is all there is to go on. Measured before any row moves:
  // a row's transform is on the group, so the word's own box is in the layer's coordinates.
  // ...and each column's own, where the key may stand in two: the first column's longest word and the
  // second's, from the key's left (a town plate's wards are short words, its countryside's marks long
  // ones — "나병자 수용소" — so the two columns are not the same width)
  const per = Math.ceil(rows.length / 2);
  // (`w1w`/`w2w` are the columns' words alone; `w1` keeps the cartouche's width as its floor, as `vw` does)
  let w1w = 0, w2w = 0, measured = false;
  const words = legend.querySelectorAll<SVGGraphicsElement>(".legend-row text");
  [...words].forEach((w, i) => {
    try {
      const b = w.getBBox();
      if (!(b.width > 0)) return;
      measured = true;
      const right = Math.ceil(b.x + b.width + 2 - vx);
      vw = Math.max(vw, right);
      if (i < per) w1w = Math.max(w1w, right); else w2w = Math.max(w2w, right);
    } catch { /* no layout (jsdom): the cartouche's width is all there is */ }
  });
  const w1 = Math.max(vw, w1w), w2 = measured ? w2w : vw;
  // The key's MEASURE: the room it stands in, less the heading's inset on each side, in the key's
  // own units (a plate's key is drawn at 11-unit rows and shown x1.545). Pixels are what the page
  // lines up, so the gap and the air are said in pixels and turned into units here.
  //
  // ⚠ The room is the panel's OWN width — its border box; the fold's body has no border or padding —
  // not the width left inside a scrollbar. User report (2026-10-15, desktop): fold the plate's key and
  // open it, and a scrollbar stands in the column; fold and open again, and it is gone. Measured at
  // 1440x900: the body is 192px wide, and read inside the scrollbar the room was 192 on one open and
  // 177 on the next, so each open drew the key for the other open's room — 180 wide at 12.3px type,
  // then 165 at 11.1, then 180 — and the scrollbar came and went with it.
  const room = (sheet.parentElement as HTMLElement | null)?.offsetWidth ?? 0;
  // ★ ...and the key is fitted to the room's HEIGHT too, where the caller could measure it (`fit.roomH`):
  // the fold beside a desktop's plate is the plate's height less what the facts keep — 427px at 1440x900,
  // 177 at 1366x650 — and a key taller than that scrolls in it. Two tight columns of the key's rows are
  // `twoTall` units; the height allows them up to `hShrink` of their scale.
  const roomH = fit?.roomH ?? 0;
  const twoTall = vh - (rows.length - per) * pitch;
  const hShrink = roomH > 0 && twoTall > 0 ? roomH / twoTall : Infinity;
  // A key that cannot stand in the room's height even at the floor will scroll, and the scrollbar takes
  // its gutter out of the width: fitted without it, the key was clamped to the width beside the
  // scrollbar and drawn 8% smaller than it was fitted for. Known before it is drawn (`fit.gutter`).
  const scrolls = fit !== undefined && measured && roomH > 0 && hShrink < fit.minScale;
  const roomPx = room > 0 ? room - KEY_INSET * 2 - (scrolls ? fit?.gutter ?? 0 : 0) : 0;
  const measure = roomPx > 0 ? roomPx / scale : 0;
  const gap = COL_GAP / scale, air = KEY_AIR / scale;
  // two columns only where they fit; an unmeasured room (jsdom, a folded panel) is not a "no" —
  // opening the fold places the key again and measures it then
  const fits = !(measure > 0) || w1 + gap + w2 <= measure;
  // ★ ...or where the key may be drawn smaller until they do (`fit`): a town plate's key is 30-32
  // rows, 554px beside a desktop's plate in a column whose fold holds 451 at 1440x900 and 257 at
  // 1366x650 — a scroll nobody notices, 27 and 12 rows seen (plate review, 2026-10-15). Drawn at the
  // scale two columns of its WORDS fit at (the cartouche's width is no floor here: a plate's wards
  // are short words), each column as wide as its own and no air between the rows, it stands whole —
  // never larger than it was asked for, and below the floor the caller sets it keeps its one readable
  // column instead. `wTight` is the scale the width allows two tight columns.
  const wTight = measured && w1w + w2w > 0 && roomPx > 0 ? (roomPx - COL_GAP) / (w1w + w2w) : Infinity;
  const tightOk = fit !== undefined && measured && w1w + w2w > 0 && roomPx > 0 && wTight >= fit.minScale;
  let drawn = scale, airNow = air, tight = false;
  let two = columns >= 2 && rows.length >= 4 && pitch > 0;
  if (two) {
    if (fits && (!measured || roomH <= 0 || twoTall * scale <= roomH)) {
      // as drawn, spread across the room — with its air only where the height has room for that too
      if (measured && roomH > 0 && (twoTall + (per - 1) * air) * scale > roomH) airNow = 0;
    } else if (tightOk) {
      // drawn smaller: as far as the width or the height asks, never under the floor (below it the key scrolls)
      tight = true; airNow = 0;
      drawn = Math.max(Math.min(scale, wTight, hShrink), fit!.minScale);
    } else two = false;
  }
  if (two) {
    const gapNow = COL_GAP / drawn, measureNow = roomPx > 0 ? roomPx / drawn : 0;
    // ★ The second column starts at the middle of the measure, not just past the first column's
    // words: measured on a phone, "just past" put it at x=144 of a panel running to 363, lined up
    // with nothing and with the right third of the panel empty — a block shoved into a corner.
    // Split evenly, it sits the way the town list under it does. And each row gets a few pixels of
    // air: at the map's own 17 the key was a dense block between a heading and 44px list rows.
    // (A shrunk key has no room to spread or to breathe: its second column starts just past the first.)
    const offset = tight ? w1w + gapNow : Math.max(w1 + gapNow, measureNow / 2);
    const fmt = (v: number) => +v.toFixed(2);
    rows.forEach((r, i) => {
      const c = i < per ? 0 : 1, k = i - c * per;
      const dx = c * offset, dy = -c * per * pitch + k * airNow;
      if (dx === 0 && dy === 0) r.removeAttribute("transform");
      else r.setAttribute("transform", `translate(${fmt(dx)} ${fmt(dy)})`);
    });
    vh += -(rows.length - per) * pitch + (per - 1) * airNow;
    vw = tight ? offset + w2w : Math.max(offset + vw, measureNow);
  } else {
    for (const r of rows) r.removeAttribute("transform");
  }
  sheet.setAttribute("viewBox", `${vx} ${vy} ${vw} ${vh}`);
  sheet.setAttribute("width", String(vw * drawn));
  sheet.setAttribute("height", String(vh * drawn));
  // ★ The clamp in PIXELS, where the room was measured. The stylesheet's is a percentage of the panel
  // (`.stage .legend-sheet`, the fallback for a room that could not be measured), and a scrolling flex
  // item resolves that twice — Chrome sizes it as if its scrollbar were there (a 180px sheet clamped to
  // 165, and so 228 tall) and lays it out without one (249 tall) — and the difference is an overflow
  // that puts a scrollbar there with nothing to scroll: measured at 1440x900, any sheet over 165px in
  // the 192px body did it, with 200px of height to spare. A clamp in pixels is the same in both.
  sheet.style.maxWidth = roomPx > 0 ? `${roomPx}px` : "";
}
