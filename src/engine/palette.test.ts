import { describe, it, expect } from "vitest";
import { NATION_PALETTE, FREE_COLOR, nationColor } from "./palette";
import { BIOME_COLORS, OCEAN } from "./biome";

// CIE76: the same yardstick the culture palette and the bridge stone were chosen with.
const lab = (h: string): [number, number, number] => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const X = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
  const Y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const Z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
};
const dE = (a: string, b: string) => {
  const [l1, a1, b1] = lab(a), [l2, a2, b2] = lab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
};

// Measured on the ten hand-picked pastels this replaces, over four seeds: the closest pair of
// nations on one map came out at 4.6 and the closest nation to the sea at 9.8. A nation the colour
// of its neighbour is a border that is not there; a nation the colour of the sea is a coastline
// that is not there.
describe("nations can be told apart", () => {
  const EIGHT = NATION_PALETTE.slice(0, 8); // what a default world actually shows

  it("keeps the nations of one map apart from each other", () => {
    let worst = Infinity, pair = "";
    for (let i = 0; i < EIGHT.length; i++) for (let j = i + 1; j < EIGHT.length; j++) {
      const d = dE(EIGHT[i], EIGHT[j]);
      if (d < worst) { worst = d; pair = `${EIGHT[i]} / ${EIGHT[j]}`; }
    }
    expect(worst, `closest pair ${pair}`).toBeGreaterThan(18);
  });

  it("keeps them off the sea and off the parchment", () => {
    for (const c of NATION_PALETTE) {
      expect(dE(c, BIOME_COLORS[OCEAN]), `${c} against the sea`).toBeGreaterThan(20);
      expect(dE(c, "#f4ecd8"), `${c} against the parchment`).toBeGreaterThan(15);
    }
  });

  // the tail is for the nations a civil war adds; they crowd more than the first eight, but a
  // world that has split five ways still has to be readable
  it("keeps even the crowded tail apart", () => {
    for (let i = 0; i < NATION_PALETTE.length; i++) for (let j = i + 1; j < NATION_PALETTE.length; j++) {
      expect(dE(NATION_PALETTE[i], NATION_PALETTE[j]), `${NATION_PALETTE[i]} / ${NATION_PALETTE[j]}`).toBeGreaterThan(11);
    }
  });

  it("gives a free city nobody's colour, well clear of every nation's", () => {
    for (const c of NATION_PALETTE) expect(dE(c, FREE_COLOR), `${c} against a free city`).toBeGreaterThan(12);
  });

  it("wraps for the nations a civil war adds, and never runs out", () => {
    expect(nationColor(0)).toBe(NATION_PALETTE[0]);
    expect(nationColor(NATION_PALETTE.length + 3)).toBe(NATION_PALETTE[3]);
    for (let id = 0; id < 60; id++) expect(nationColor(id)).toMatch(/^#[0-9a-f]{6}$/);
  });
});
