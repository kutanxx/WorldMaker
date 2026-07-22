# Attack-verdict encoding: badge + hatch (design)

Date: 2026-07-22
Scope: `playProvince.html` (province game), conquer stance. UI-only.

## Problem

The play map colours every attackable province by the deterministic outcome: green
`#2f8f4e` = you would capture it, red `#b23a3a` = the defender is too strong, both at
`fill-opacity: 0.16`. The user reported they cannot tell the two apart.

Measured on the live page, the composited contrast between a green target and a red target
is **1.01–1.12** (WCAG's minimum for non-text is 3.0). Over the orange nation `#a8532f`
the two are 1.01 — mathematically the same colour.

The cause is structural, not a matter of the tint being too faint:

1. The tint is only 16%, so the nation colour beneath shows through at 84%.
2. **Hue is already carrying ownership.** The map paints eight nation colours to answer
   "whose land is this?". Layering an ownership-independent green/red on top makes the two
   variables fight: the same green tint reads purple over a purple nation and orange over
   an orange one.
3. The solidarity wash (parchment, up to 50%) then covers both.

Raising the tint's opacity trades one failure for another — it would wash out the
ownership colours the map depends on.

## Research basis

A verified research pass (2026-07-22) established three things. Note up front what it did
**not** establish: no claims about how EU4, Civ VI, Total War, HOI4, Risk, Polytopia,
Advance Wars or XCOM encode this survived verification. This design rests on perception
research and accessibility standards, not on a competitive teardown.

1. **With hue committed to ownership, the second variable must ride a separable,
   non-hue channel** — outline style/width/dash, an overlaid glyph, or a pattern.
   Re-modulating the fill hue is the worst option: on the separability continuum
   (Garner & Felfoldy → Ware → Munzner) position+hue is fully separable, size+hue shows
   some interference, and **red+green is the canonical "major interference" case**. A
   CHI 2026 study of bivariate symbol maps (n=197) found colour × shape the most separable
   pair (accuracy 0.882). Pattern is specifically what designers reach for "when color is
   either limited or already encodes other data dimensions" (He, Dykes, Isenberg &
   Isenberg, IEEE TVCG).
2. **Do not put the decision-critical distinction on symbol size.** Same CHI 2026 study:
   accuracy 0.944 when *shape* carried the task-relevant variable versus **0.760 when
   size did** (p<.0001). An earlier draft of this design sized ✓ larger than ✕; that is
   corrected here — the glyphs are the same size and shape alone discriminates.
3. **The standard remedy for red/green is redundant non-colour encoding**, not a different
   hue pair. Xbox Accessibility Guidelines 103 names this exact case as its worked failure
   example: *"when enemy characters are outlined in red, ally characters are outlined in
   green, players who are unable to discern the difference between those two colors will
   be unable to use this key information."* The prescribed fix is at least one additional
   signifier — shape, pattern, iconography, or text. Red/green CVD affects ~8% of males of
   European ancestry, 4–6.5% East Asian. XAG further requires that a greyed-out
   unavailable state be accompanied by a second signifier, never grey alone.

## Design

Two verdicts, two different channels. Hue goes back to meaning ownership.

**Can take it → a ✓ badge** at the province centroid: a parchment disc (r≈9, fill
`#f4ecd8`, stroke `#3c2f1c` 1.2) with an ink ✓ (`#1f6b3a`, 12px, bold). Same material as
the map's existing seat dots and parchment palette, so it adds no new visual vocabulary.

**Too strong → 45° diagonal hatching** across the whole province: one `<pattern>`
(7px spacing, `#3c2f1c` stroke 1.6 at 0.28 opacity, `patternUnits="userSpaceOnUse"`).
No glyph. Hatching scales with the province rather than sitting at a fixed footprint, so
it survives on small provinces, and 45° avoids reading as another region boundary (the
existing borders are dominated by horizontal and vertical runs). Research guidance:
diagonal hatch, at most one or two pattern categories, low contrast and density to avoid
moiré across ~100 small provinces — all satisfied by a single low-opacity pattern.

**The existing green/red tint stays**, demoted from primary signal to two secondary jobs:
it marks "this province is clickable at all", and it redundantly reinforces the verdict for
players who do see the hues. This redundancy is exactly what XAG asks for — colour *plus*
a non-colour signifier.

The armed-target gold ring is unchanged and coexists with hatching: a player may target a
province they cannot take (and fail), so both marks can appear on the same province.

### Phone scale correction

The map is a fixed 1000×700 viewBox fitted to its container, so anything authored in
viewBox units shrinks with the map: at ~900px desktop the scale is ~0.9, but at ~360px
phone it is ~0.36, which would render the r=9 badge at about 3 screen pixels.

The province map has **no zoom/pan** (unlike the cell game) and no resize listeners, so
scale is a pure function of viewport width. Counter-scale the badge to a constant on-screen
size:

```
k = clamp(1000 / renderedMapWidthPx, 1, 2)
badge = <g transform="translate(cx,cy) scale(k)">…</g>
```

- desktop ~900px → k ≈ 1.11 → ~9 screen px
- phone ~360px → k = 2 (capped) → ~6.5 screen px

The cap is a deliberate compromise: a constant-size badge and a shrinking province pull in
opposite directions, and on a phone a province is only ~24px wide, so an uncapped badge
would swallow it. Hatching is unaffected — it scales with the province by construction.

`getBoundingClientRect()` returns 0 in jsdom and before layout, so **k falls back to 1**;
the scale computation is a pure exported helper, tested directly.

A single debounced `resize` listener is registered **once in `mountProvinceApp`**, not per
render — `render()` runs many times per game and per-render registration would stack
listeners.

**Per-province cap.** The global counter-scale above keeps the badge a constant ON-SCREEN
size, but that alone can make the badge bigger than the land it marks: measured at a 370px
map width, the global cap of `k=2` produced a 13.2px disc (`r=9 * (370/1000) * 2`) over a
17.5×12.1px province — a coverage ratio of 1.09, the badge literally bigger than the
province. So `targetOverlay` additionally caps each badge's diameter to `0.7 × span / 18`,
where `span` (`provinceSpan()`) is that province's own smaller bounding-box extent in fixed
viewBox units (`BADGE_DIAMETER = 18` is the badge's authored diameter at scale 1). The
final scale is `k = min(badgeK, fit)` — never bigger than the global counter-scale, never
bigger than 70% of the land it sits on.

That cap alone has no floor, though, and is a pure downscale: on a 1–2 cell province
(routine on coastal/leftover land, `span` as low as ~14 viewBox units against a ~13-unit
cell), `fit` drops to roughly 0.5 — a badge under 5px on a 900px map. Since the ✓ badge is
the **only** non-colour cue for "you can take this" (hatching marks only the negative
case), an illegible badge silently drops the player back onto the colour-only reading this
design exists to fix. The final scale is therefore floored at 1:
`k = max(1, min(badgeK, fit))` — the badge is never drawn smaller than its authored size.
The deliberate consequence: on a province too small to contain it, the ✓ overflows that
province's own borders slightly. That trade is intentional — the badge stays centred on
the right land and stays legible; a hair of visual overflow on rare tiny provinces is
cheaper than an unreadable decision-critical mark.

### Legend

The conquer-mode legend clause becomes "✓ 점령 가능 · 빗금 = 너무 강함" / "✓ = you can take
· hatched = too strong", replacing the colour-only wording. The ⚓ sea-expedition clause is
unchanged.

## Non-goals

- No engine change. Golden hashes (init `226648593`, 50-tick `2503300448`, player path
  `2374466985`, Version A `1350115163`) stay untouched.
- Battle-preview rows, the risk panel, and the ping feature are not touched.
- The tint colours themselves are not re-picked for CVD safety. Once shape and pattern
  carry the decision, the hue is redundant, so re-tuning it is optional polish, not part
  of this change.

## Documented fallback (not built now)

If the badge proves unreadable on a real phone, drop the badge and keep hatching alone:
"a target without hatching is one you can take". Information is preserved by pattern
presence/absence, and hatching scales with the province on any screen. This retreat exists
*because* the negative case is encoded as a pattern rather than a second glyph. Do not
build it until a real phone says it is needed.

## Files

- `src/ui/provinceApp.ts`
- `src/theme.css`

## Tests

1. Every winnable target gets exactly one `✓` badge; the badge count equals the number of
   `.prov-target.winnable` provinces.
2. Every too-strong target gets the hatch fill and **no** badge.
3. The hatch `<pattern>` is defined exactly once per map render (not once per province).
4. Badges and hatch paths are `pointer-events: none`.
5. Regression: clicking a target still arms it, and clicking a hatched (too-strong) target
   still arms it — an unwinnable province remains selectable.
6. The badge-scale helper is pure: returns 1 for a zero/unknown width, ~1.11 for 900px,
   and clamps to 2 for a 360px phone.

## Verification limits

jsdom loads no CSS and does no layout, so clickability must be confirmed in a real browser
via `document.elementFromPoint` (the 07-15 picker incident: jsdom tests passed while real
clicks were blocked).

Screenshots are harness-blocked, so whether the hatch reads as "locked" rather than "dirty"
is the user's call after deploy. The phone badge size (`pointer: coarse` cannot be
emulated) needs a real device — pair this with backlog item ⓚ.
