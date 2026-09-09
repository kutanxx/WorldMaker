import type { World } from "../types/world";

// Distinct, parchment-friendly nation hues. Applied at render time (indexed by
// polity id), so nations stay distinguishable regardless of the engine's pastel
// palette. Purely cosmetic — not part of any rng/seed, so determinism holds.
export const NATION_PALETTE = [
  "#b5432f", "#3f6f8f", "#5f7a2f", "#c08a2f", "#6b4a7a", "#2f8f7a",
  "#a8532f", "#43683f", "#7a5a2f", "#7a2f4a", "#3f7a6f", "#4a4a8a",
];

export function nationColor(id: number): string {
  const n = NATION_PALETTE.length;
  return NATION_PALETTE[((id % n) + n) % n];
}

/**
 * Colour the realms the way a cartographer does: no two that share a border share a colour.
 *
 * Indexing the palette by id (`nationColor`) draws id 12 in exactly the colour of id 0, and a world
 * makes 15-22 realms. Worse, civil-war fragments take the high ids AND appear beside the parent
 * they broke from, so the two realms drawn alike are often the two with a border between them —
 * which then reads as no border at all. Measured over twelve seeds: every world had two living
 * realms in one colour, and seven had two of them TOUCHING on the province-snapped map a reader is
 * actually shown.
 *
 * `frames` are ownership arrays — the history's snapshots — and two realms count as neighbours if
 * they are adjacent in ANY ONE of them. Unioning over the whole history rather than colouring each
 * year separately is what lets a realm keep one colour from its founding to its fall; a realm that
 * changed colour as its neighbours came and went would be worse than the collision this fixes.
 *
 * Greedy, in descending order of how many neighbours a realm has (Welsh-Powell), which needs five
 * colours on every seed measured. But five colours would hand the legend one swatch for several
 * realms, so among the colours that break no border the least-used one wins, spending all twelve.
 * Pure and deterministic: no rng, no seed, nothing an anchor could see.
 */
export function assignNationColors(
  neighbors: readonly (readonly number[])[],
  frames: readonly ArrayLike<number>[],
): Map<number, string> {
  const adj = new Map<number, Set<number>>();
  const alongside = new Map<number, Set<number>>();      // realms that stand in the same year
  const see = (m: Map<number, Set<number>>, id: number) => {
    let s = m.get(id);
    if (!s) { s = new Set(); m.set(id, s); }
    return s;
  };
  for (const owner of frames) {
    const living = new Set<number>();
    for (let i = 0; i < owner.length; i++) {
      const a = owner[i];
      if (a < 0) continue;
      living.add(a);
      see(adj, a);
      for (const nb of neighbors[i] ?? []) {
        const b = owner[nb];
        if (b < 0 || b === a) continue;
        see(adj, a).add(b);
        see(adj, b).add(a);
      }
    }
    for (const a of living) for (const b of living) if (a !== b) see(alongside, a).add(b);
  }

  // Most-constrained first, ties by id so the assignment never depends on Map insertion order.
  const order = [...adj.keys()].sort((x, y) => (adj.get(y)!.size - adj.get(x)!.size) || (x - y));
  const chosen = new Map<number, number>();
  const spent = new Array<number>(NATION_PALETTE.length).fill(0);

  for (const id of order) {
    const clashes = new Array<number>(NATION_PALETTE.length).fill(0);
    for (const nb of adj.get(id)!) {
      const c = chosen.get(nb);
      if (c !== undefined) clashes[c]++;
    }
    // Two realms that merely STAND IN THE SAME YEAR want different colours too, even when their
    // territories never touch — the legend is a key from swatch to realm, and it stops being one
    // the moment two rows carry the same swatch. Measured without this: 409 of 612 year-snapshots
    // handed out a duplicate swatch. It cannot always be honoured (fourteen realms have stood at
    // once against twelve colours), so it is a preference, not the rule.
    const together = new Array<number>(NATION_PALETTE.length).fill(0);
    for (const co of alongside.get(id) ?? []) {
      const c = chosen.get(co);
      if (c !== undefined) together[c]++;
    }
    // Breaking a border is incomparably worse than repeating a swatch, which is in turn worse than
    // leaving a hue unspent, so each tier dominates the next outright instead of being weighed
    // against it.
    let best = 0, bestScore = Infinity;
    for (let c = 0; c < NATION_PALETTE.length; c++) {
      const score = clashes[c] * 1e6 + together[c] * 1e3 + spent[c];
      if (score < bestScore) { bestScore = score; best = c; }
    }
    chosen.set(id, best);
    spent[best]++;
  }

  return new Map([...chosen].map(([id, c]) => [id, NATION_PALETTE[c]]));
}

// The player's realm is always rendered in this reserved signature colour (play mode only), so
// "which realm is mine" needs no swatch-matching. Deep magenta: the one hue family absent from the
// map (no pinks), colourblind-safe (Okabe-Ito reddish-purple), avoids the blue↔purple confusion a
// violet would cause given the map's many blues. Render-time only — not seeded.
export const PLAYER_COLOR = "#c0247a";

// The player's nation LABEL text — gold, so it stays legible ON the magenta player territory
// (magenta text blended in). Gold contrasts strongly with magenta and matches the gold ♛ crown.
export const PLAYER_LABEL_COLOR = "#f0c040";

type GridLike = Pick<World["grid"], "count" | "points">;

export interface Centroid {
  x: number;
  y: number;
  cells: number;
}

// Label anchor for each present polity: the owned cell-centre NEAREST the polity's mean (a
// medoid), plus its cell count. Snapping to a member cell — rather than using the bare mean —
// keeps the label ON the territory; a concave or post-conquest (disconnected) shape can have a
// mean that falls in the sea or a neighbour. Matches the region-label treatment in geography.ts.
export function nationCentroids(grid: GridLike, owner: ArrayLike<number>): Map<number, Centroid> {
  const acc = new Map<number, { sx: number; sy: number; cells: number }>();
  for (let i = 0; i < grid.count; i++) {
    const o = owner[i];
    if (o < 0) continue;
    const a = acc.get(o) ?? { sx: 0, sy: 0, cells: 0 };
    a.sx += grid.points[i * 2];
    a.sy += grid.points[i * 2 + 1];
    a.cells++;
    acc.set(o, a);
  }
  const mean = new Map<number, { mx: number; my: number; cells: number }>();
  for (const [o, a] of acc) mean.set(o, { mx: a.sx / a.cells, my: a.sy / a.cells, cells: a.cells });
  // second pass: for each polity, keep the owned cell closest to its mean
  const best = new Map<number, { x: number; y: number; d: number }>();
  for (let i = 0; i < grid.count; i++) {
    const o = owner[i];
    if (o < 0) continue;
    const m = mean.get(o)!;
    const x = grid.points[i * 2], y = grid.points[i * 2 + 1];
    const dx = x - m.mx, dy = y - m.my, d = dx * dx + dy * dy;
    const b = best.get(o);
    if (!b || d < b.d) best.set(o, { x, y, d });
  }
  const out = new Map<number, Centroid>();
  for (const [o, m] of mean) { const b = best.get(o)!; out.set(o, { x: b.x, y: b.y, cells: m.cells }); }
  return out;
}
