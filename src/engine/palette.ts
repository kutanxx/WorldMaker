// The colours a nation is drawn in.
//
// There used to be two copies of this list, identical, one in polities.ts and one in historySim.ts.
// Both were ten hand-picked pastels, and measured over four seeds they failed twice over:
//
//   the closest pair of nations on one map   CIE76  4.6   (indistinguishable)
//   the closest nation to the sea (#c9dae4)  CIE76  9.8   (half the nations were within 25)
//
// A nation the colour of its neighbour is a border that is not there; a nation the colour of the
// sea is a coastline that is not there. So the palette is laid out rather than picked: hues walked
// by the golden ratio, so any PREFIX of the list is well spread and the eight nations a world
// usually has do not carry the crowding of the whole twelve; the sea's own hue band (202 degrees,
// plus or minus 24) left out entirely; and each slot given whichever of three lightnesses stands
// furthest from the sea, the parchment, a free city and the nations already chosen. Alternating
// lightness mechanically is not enough — parchment is itself a pale warm yellow, so the pale
// yellow slot has to be the dark one.
//
// Measured: closest pair among the first eight 20.4 (was 4.6), closest to the sea 22.4 (was 9.8),
// to the parchment 18.5, to a free city 20.3. Still pastel: this is an atlas, not a political wall
// chart, and a saturated palette would win the measurement by losing the map.
export const NATION_PALETTE = [
  "#d08080", "#8280d0", "#bed080", "#d080bd", "#80d0a4", "#d0a680",
  "#d0bce6", "#c9e6bc", "#e6bcc8", "#80d0ca", "#dbd79e", "#d89edb",
];

// a free city answers to nobody, and is drawn in nobody's colour
export const FREE_COLOR = "#b7b1a4";

export const nationColor = (id: number): string => NATION_PALETTE[id % NATION_PALETTE.length];
