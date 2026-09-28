# A region of the map for a book's chapter (보이는 부분 내보내기) — design

2026-09-28. The reader asked what was next; with no defects left, new candidates were researched (FMG issues
#142, #296, #382, #69, #690 and Discussion #1082 ask for a country's or a small area's map, or one at a size
for print) and this one was picked: the part of the world map on screen, written at print size. Asked whether
black-and-white was needed at all, the answer was measured — a book's interior is printed in one ink (KDP
prices the whole interior by the ink chosen: a 300-page novel $4.60 black, $8.65–$20.50 colour), and the
colour map in grey loses sea against tundra (1.3 L*) and 7 of 8 realm colours against a neighbour — and the
reader chose colour and ink both. The way the region is drawn and the way it is chosen were picked from a
preview drawn on world 1 (`.claude/probes/out/region-preview.html`, `regionpreview.ts`).

## What the reader does

- Zoomed in on the world map, PNG and SVG open a small menu under the formats: "전체 지도 / Whole map" and
  "보이는 부분 / Visible area" with the ground it holds ("1000×700 km"). Escape, a press elsewhere or the
  keyboard moving on closes it and writes nothing. Not zoomed in, or on a town's plate, nothing is asked and
  the file is what it always was. (FMG writes the visible part without asking, and a reader who expected the
  whole map got part of it — the reason to ask.)
- The zoom now holds through a change of view, of ink and of language (it used to reset to the whole map), so
  a region framed for a file stays framed on the way to the file.
- The region is written as a page of its own, the same width as the whole map's: `world-region.png` /
  `.svg`, in the view, year and style on screen.

## How the region is drawn: the page's law, not the zoomed screen

Rejected, from the preview: the zoomed screen enlarged — names 1.6x the whole map's, a range's peaks and a
forest's trees three times the size and nine times as sparse. Chosen: everything the whole map sizes by its
page keeps that size, so a chapter's map and the world's, printed the same size, read as one set.

- Names (`labelScale.ts` `applyPageScale`): the whole map's reading size over z; a region name's tracking,
  a town name's gap from its dot and a river name's lift off its water scaled with it; marks, and a free
  city's banner and name, held at their page size about their own point. At z = 1 it is exactly the old pair
  `applyLabelScale(svg, 1)` + `applyMarkerScale(svg, 1)`.
- The cull (`deconflict.ts`, `room` = 1/z): the air a name keeps (4) and its margin from the frame (10) are
  the whole map's page units.
- Glyphs a cell stands for (`regionPage.ts` `spreadInCell`, used by `svgWorldRenderer.ts` and
  `inkStyle.ts`): z^2 to a cell at 1/z the size, spread over the cell by its hash with a page-sized gap —
  colour peak chevrons, ink peaks, trees, palms, marsh tufts, dunes, hills — for the cells on the page only.
- Water lines: the colour map's three bands and the ink map's rings at the whole map's spacing.
- Furniture (`putOnPage`): the key(s), title, compass, scale bar and frame carried to the page's corners as
  one group, `translate(x y) scale(1/z)` with `data-x/-y/-k` for the cull to map its boxes; the bar measured
  again (the largest 1, 2 or 5 x 10^n km within 360/z — 100 km at 3x) in the whole map's type
  (`scaleBar(…, type)`), in the inks the old bar was drawn in.
- Names of what is not on the page are not set on it: a town by its dot, an area by where its name stands; a
  river whose name stands off the page but whose course crosses it (3+ points) is named again at the middle
  of that crossing (`riverName.ts`, shared with the renderer).

## Files

- PNG: 3000 x 2100, colour and ink, whole map or region, the screen-pinned lines thickened with it
  (`forPrint`). The pixel size no longer depends on the screen's pixel ratio (`svgToPngBlob` drew width x
  devicePixelRatio: 4500 px on a 150% laptop). A plate is still 2x its drawing, now at every pixel ratio.
- SVG: vector, the region as its viewBox.

## Pinned

The whole map is untouched: the colour map's four views keep their FNV pins, and the ink map's four views
were pinned before `inkMarks` changed ([737587710, 3864053538, 182143499, 2924723875]). World and plate
byte-locks untouched (no engine change).

## Limits

- An area whose name stands off the page is not named on it, even when much of the area is on it (regions
  carry a centroid, not their cells).
- A rotated river name's box is its unrotated one, on the page as on the screen.
