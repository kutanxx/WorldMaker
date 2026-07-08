# Reserved Player Color — "which realm is mine" (Version B)

**Date:** 2026-07-08
**Status:** Design approved (research + self-critique), ready for plan
**Scope:** Version B play map. `src/ui/nationPalette.ts` (a reserved-color constant), `src/ui/politicalLayer.ts` (optional player override), `src/ui/playApp.ts` / `src/theme.css`. Render-time only (not part of any rng/seed) → determinism + engine goldens unaffected; Version A map unchanged (it passes no player).

## Problem

Even after the prior nation chip + capital crown + faint own-tint, the user still can't tell which nation is theirs on the map. Root cause: the player's realm is drawn in one of 12 procedurally-assigned earthy hues, so the player must **match a tiny chip swatch to a blob** among 8 similar-colored nations. The faint tint (`opacity 0.12`) was too weak to fix this.

## Research + self-critique

- **Color-coded factions are a genre convention** — each side has a fixed, distinct color; the player's own side is reserved (often blue). ([Color-Coded Armies](https://tvtropes.org/pmwiki/pmwiki.php/Main/ColorCodedArmies)) So "the player's nation is always THE signature color" is standard and eliminates swatch-matching.
- **Why reserved fill, not label-color-only or an outline** (self-critique of the alternatives): the prior attempt already failed *because* it relied on matching a swatch to a blob. Recoloring only the label doesn't make the territory *extent* pop; a bold territory outline would sit on the same edges as the existing green/red front-line overlay and add clutter. Only a **reserved fill color** removes matching entirely — "my realm is always this color."
- **Color-clash constraint:** the play map already uses pale blue (ocean), red (`#c0473f` threat line), green (`#3f9e57` push), a blue tint (sea-landing), and gold (city sites), plus 12 muted earthy AI hues. The signature must be a **high-saturation color clearly distinct from all of those**.
- **Colorblind research drove the hue choice.** Blue, orange, and magenta are the safest across color-vision deficiencies, but a key rule is **"avoid pairing blue with purple"** — and this map is full of blues (ocean, landing tint, two AI blues), so a violet/purple signature (my first instinct) risks blue-purple confusion. **Magenta / reddish-purple is the right pick**: it is the one hue family entirely absent from the map (no pinks anywhere), it is a colorblind-safe color in the Okabe-Ito standard (its reddish-purple), and it pops on parchment through saturation contrast. Sources: [Color-Coded Armies](https://tvtropes.org/pmwiki/pmwiki.php/Main/ColorCodedArmies), [Venngage colorblind palettes](https://venngage.com/blog/color-blind-friendly-palette/), [David Nichols — Coloring for Colorblindness](https://davidmathlogic.com/colorblind/).
- **Redundant non-color cues** back the hue anyway — the capital ♛ crown (kept) and a ♛-marked bold nation label — so identification never depends on hue alone.

## Design

In play mode only, the player's nation is rendered in a **reserved signature color** and its label is marked:

- **Reserved fill:** `PLAYER_COLOR = "#c0247a"` (a deep magenta/fuchsia — the colorblind-safe reddish-purple family, chosen deeper than the muted Okabe-Ito reference so it reads assertively as a territory fill; the exact hex is the one thing to eyeball/tune). The player's territory fills with `PLAYER_COLOR` at a slightly stronger opacity (0.72 vs the 0.58 AI fill) so it reads as clearly "yours" regardless of which nation was picked. The nation chip's swatch uses the same `PLAYER_COLOR` (so chip ↔ map match trivially).
- **Marked label:** the player's nation label renders bold with a `♛ ` prefix (`class="nation-label player"`), reinforcing identity when zoomed and for colorblind players.
- **Capital ♛ crown:** kept as-is.
- **Remove the faint own-tint** overlay (superseded by the reserved fill; it was too weak to matter).

## Architecture

- `src/ui/nationPalette.ts`: `export const PLAYER_COLOR = "#c0247a";` (render-time cosmetic, like `NATION_PALETTE` — not seeded).
- `src/ui/politicalLayer.ts`: extend `PoliticalOpts` with optional `playerPolity?: number` and `playerColor?: string`. In the fills loop, when `id === opts.playerPolity` use `opts.playerColor ?? nationColor(id)` and fill-opacity `0.72`. In the labels loop, when `id === opts.playerPolity` add the `player` class and prefix the text with `♛ `. When `playerPolity` is undefined (Version A), behavior is byte-identical to today.
- `src/ui/playApp.ts`:
  - `renderMap`: pass `playerPolity: s.playerPolity, playerColor: PLAYER_COLOR` in the `politicalLayer(...)` opts; delete the own-tint block (the `mine`/`.own-tint` path). Keep the capital-crown block.
  - `renderPanel`: the nation chip swatch background becomes `PLAYER_COLOR` (was `nationColor(s.playerPolity)`).
  - Import `PLAYER_COLOR` from `./nationPalette`.
- `src/theme.css`: `.nation-label.player { font-weight: 700; }`.

## Data flow

Unchanged. `renderMap` builds the political layer each turn; the only change is the player's fill color/opacity and label marker, plus the removed tint.

## Error / edge handling

- Fallen player (no cells): no player fill is drawn (no owned cells); the chip/label simply don't appear — unchanged.
- Version A (`map.html`) never sets `playerPolity`, so its map, legend, and `politicalLayer` golden behavior are untouched.

## Testing

- `src/ui/politicalLayer.test.ts`: with `playerPolity` + `playerColor` set, that polity's `.territory` path `fill` equals `playerColor` (and another polity's does not); the player's `.nation-label` carries the `player` class and its text starts with `♛`. Without `playerPolity`, no `.nation-label.player` and fills use `nationColor` (unchanged path).
- `src/ui/playApp.test.ts`: the play map contains a `.nation-label.player`; the nation-chip swatch `background` is `PLAYER_COLOR`; the old `.own-tint` element is gone. **The existing nation-emphasis test currently asserts `.own-tint` is present — that assertion must be updated** (drop `.own-tint`, add the `.nation-label.player` check) since the tint is removed.
- **Golden regression:** engine/world/history goldens unaffected (colors are render-time, not seeded); Version A `politicalLayer` output unchanged when no player is passed.
- Exact signature hue is visual → the user eyeballs localhost.

## Out of scope (YAGNI)

Letting the player pick their own color; recoloring AI nations; applying the reserved color in Version A; a legend entry (the in-map legend is already suppressed in play mode).
