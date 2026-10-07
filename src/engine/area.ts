// Land in square kilometres, by the map's own scale.
//
// The gazetteer and the chronicle measured a realm in the map's cells ("362칸", "41 → 23 tiles") — the
// generator's unit, which no reader can picture. The scale bar has always said how far the ground is (3 km
// to the unit), and the same scale says how much of it there is: a cell holds the map's area over its count.

/** How many km one unit of the map is — the scale bar's own (120 units, 360 km). */
export const KM_PER_UNIT = 3;

/** The ground `cells` cells cover, in km², for a map of these dimensions. */
export function cellsToKm2(cells: number, p: { width: number; height: number; cellCount: number }): number {
  return cells * ((p.width * p.height) / p.cellCount) * KM_PER_UNIT * KM_PER_UNIT;
}

// two significant figures: what a reader can hold, and no more than a hand-drawn map can claim
function twoFigures(n: number): number {
  if (!(n > 0)) return 0;
  const step = Math.pow(10, Math.max(0, Math.floor(Math.log10(n)) - 1));
  return Math.round(n / step) * step;
}

// a number as the language says it: Korean counts large areas in 만 (ten thousands)
function figure(n: number, lang: "ko" | "en"): string {
  const r = twoFigures(n);
  if (lang === "ko" && r >= 100_000) return `${Math.round(r / 10_000).toLocaleString("ko-KR")}만`;
  return r.toLocaleString(lang === "ko" ? "ko-KR" : "en-US");
}

// Korean print writes the square kilometre as one sign, ㎢ — and a Korean document keeps no Latin letters
// (gazetteer.test: every word is Hangul)
const unit = (lang: "ko" | "en") => (lang === "ko" ? "㎢" : "km²");

/** "약 57만 ㎢" / "about 570,000 km²" */
export function formatArea(km2: number, lang: "ko" | "en"): string {
  return `${lang === "ko" ? "약" : "about"} ${figure(km2, lang)} ${unit(lang)}`;
}

/** "약 57만 → 23만 ㎢" / "about 570,000 → 230,000 km²" — a change said once, with the unit at its end. */
export function formatAreaChange(fromKm2: number, toKm2: number, lang: "ko" | "en"): string {
  return `${lang === "ko" ? "약" : "about"} ${figure(fromKm2, lang)} → ${figure(toKm2, lang)} ${unit(lang)}`;
}
