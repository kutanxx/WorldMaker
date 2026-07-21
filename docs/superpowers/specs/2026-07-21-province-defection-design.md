# Province Defection — loyalty-flip so thin overextension costs you

**Date:** 2026-07-21
**Status:** Approved design
**Feature:** province-sim defection/revolt (the "ⓖ 저안정 province 자동 반란/이탈" backlog item)

## Why

Holding territory in the province game is currently free. Once a province is conquered it stays
yours forever unless an enemy takes it by force — so a thin salient driven deep into enemy land, or
a lone overseas province seized by a sea-lane expedition, carries no ongoing cost. SP3's measurements
repeatedly found the same root problem: expansion has no self-limiting pressure, so "grab everything
reachable" is close to optimal and the interesting decision (push vs. hold) is thin.

This adds the last big structural lever SP3's research identified: **Civ6-style loyalty flipping** —
a province that is politically isolated and far from its capital defects to the rival pressing it.

It pairs directly with the sea lanes shipped in `2026-07-20-province-sea-lanes-design.md`: naval
expeditions can now take distant provinces on a rival's landmass, and this mechanic is what makes
those conquests a real commitment rather than free real estate.

## Key constraint discovered

`computeSteppedSol` raises a province's solidarity when it is a frontier and **decays it otherwise**,
so every interior province of a peaceful empire drifts to 0. That is harmless today (interior
provinces border no enemy and cannot be attacked), but it means **a naive "low solidarity → revolt"
rule would make every peaceful empire's interior revolt.** Solidarity also cannot serve as the
loyalty meter for the opposite reason: a thin salient surrounded by enemies is a frontier, so its
solidarity *rises* — exactly backwards for this purpose.

Therefore defection is driven by **local pressure**, not by raw solidarity, and the countdown lives
in its own state.

## Mechanic

### Pressure (rng-free; uses only existing state)

For each province `p` owned by `o` where `o >= 0` and `p` is NOT `o`'s capital province:

```
hold(p)  = (number of land-adjacent provinces owned by o)
         + REVOLT_SELF * provSol[p]                 // its own garrison
         - REVOLT_DIST * centroidDist(p, capitalProv[o])

press(p) = max over rivals r != o of
             (number of land-adjacent provinces owned by r)
```

Unowned neighbours (`provOwner === -1`) contribute to neither `hold` nor `press` — wilderness applies
no political pull and offers no support. A polity that is no longer `alive` still counts as a rival
for `press` if it holds land (it can still absorb a defection, exactly as it can still be attacked
under `armableTargets`).

Starting constant values (set concretely so the mechanic is testable; **confirmed or adjusted once by
the acceptance measurement below**): `UNREST_FLIP = 3`, `REVOLT_SELF = 2` (a fully solid province
counts for about two friendly neighbours), `REVOLT_DIST = 0.003` (centroid distance runs to roughly
800 on the default grid, so the far end of the map costs about 2.4 — the same order as the
neighbour counts it competes with).

**Adjacency here is LAND only (`adj`), never `laneAdj`** — a sea lane is a military route, not a
shared border community. This choice produces the three behaviours the design wants:

- **Deep interior:** every neighbour is yours → `press = 0` → never defects, no matter how far its
  solidarity has decayed. (Resolves the constraint above.)
- **Thin salient in enemy land:** one friendly neighbour, several hostile → at risk.
- **Overseas province taken by expedition:** sits on the rival's landmass (hostile land neighbours,
  few or no friendly ones) and is far from your capital → the most at-risk case.

An island province with no land neighbours has `press = 0` and never defects — correct: nobody
borders it.

### Countdown and flip

New state field `unrest: Int32Array` on `ProvinceSimState`, one entry per province.

- Each tick: if `press(p) > hold(p)` then `unrest[p]++`, else `unrest[p] = 0` (recovering resets the
  clock immediately — a deliberately forgiving rule).
- When `unrest[p] >= UNREST_FLIP` the province flips **whole** to the rival `r` that supplies the
  maximum pressure (ties → lower polity id).
- Any ownership change (conquest OR defection) sets `unrest[p] = 0`, so a freshly taken province
  always gets the full `UNREST_FLIP` turns of grace.
- **Double-buffered** like `contestPass`: all flips are decided from the pre-defection ownership and
  applied together, so defections cannot cascade within one tick.
- **A capital province never defects** → no nation can be eliminated without combat.
- Applies **symmetrically** to the player and to every AI nation.

Step order becomes: `stepSolidarity → contestPass → revoltPass → recomputeAlive → tick++` (both in
`stepProvinceSim` and `stepPlayerTurn`).

### Player agency (existing levers gain purpose)

- **Consolidate** raises `provSol[p]`, which raises `hold(p)` via `REVOLT_SELF` — shoring up a
  wavering province stops or resets its countdown.
- **Conquering the province pressing it** lowers `press` and raises the friendly-neighbour count.

So "take it and move on" stops working; you must either consolidate a conquest or widen around it.

### UI (`provinceApp`)

- At-risk provinces the player owns get a warning badge: `⚠ 이탈 2턴` / `⚠ defects in 2`, showing
  `UNREST_FLIP - unrest[p]` turns remaining. Presented as an **event warning, not a second meter** —
  the game already went through several rounds of metric renaming (결속 → 민심 → 안정도) and must not
  introduce a competing percentage stat next to stability.
- A chronicle log line when a province defects, distinct from `정복` (conquest) and `상실` (lost in
  battle): `이탈` / `defected`.
- v1 shows warnings for the **player's own provinces only** — the purpose is the punishment signal.
  Enemy-defection previews are explicitly out of scope.

## Golden & determinism

Engine behaviour changes, so **re-pin** the 50-tick AI-world hash and the player-path hash
(capture-and-pin, as with sea lanes). The init-owner hash `226648593` and Version A's
`polityOf 1350115163` must remain unchanged — defection touches neither initial ownership nor the
cell sim. All logic stays inside `provinceSim.ts`; no new imports.

## Acceptance (probe-verified before merge; throwaway file policy)

The three constants start at the values given above and are **confirmed by measurement**, not left to
guesswork. Across ~20 seeds, record and check:

1. **Defections happen but empires don't crumble.** Some defections per 50-tick game (non-zero), yet
   the top nation still holds a substantial realm — no runaway disintegration.
2. **Interiors never defect.** Assert directly: no province all of whose land neighbours share its
   owner ever flips.
3. **Overexposed conquests do defect** — the mechanic actually fires on isolated salients.
4. **World stays dynamic.** The non-static invariant (`aliveEnd < aliveStart`, leader's share shifts)
   still holds; report the numbers if it does not rather than tuning to force it.
5. **Player can still win.** A conquest-policy headless run still reaches domination on some seeds —
   defection must not make expansion pointless.

If the numbers are bad, adjust the three constants once and re-measure; record the decision.

## Non-goals

Free cities / unowned defection; rebel units or civil-war factions; culture, religion, or happiness
pressure; capital defection; enemy-defection warning UI; save/load of `unrest`; any change to the
solidarity rise/decay model itself.

## Testing

1. **Pressure unit** — `hold`/`press` on hand-built fixtures: deep interior yields `press = 0`; a
   salient with more hostile than friendly land neighbours yields `press > hold`; a lane-only
   neighbour contributes to neither (land-only adjacency).
2. **Countdown** — `unrest` increments while pressed, resets to 0 the tick the pressure lifts, and
   resets on ownership change.
3. **Flip** — at `UNREST_FLIP` the province flips to the maximum-pressure rival (ties → lower id);
   the whole province moves; a capital province never flips; two provinces flipping in one tick both
   resolve from pre-flip ownership (no cascade).
4. **Symmetry** — an AI nation's exposed province defects to the player under the same rule.
5. **provinceApp DOM** — the `⚠` badge renders with the correct remaining count for an at-risk
   player province and is absent otherwise; the defection log line appears.
6. **Golden guards** — re-pinned 50-tick and player-path hashes; init and Version A unchanged.

## Sources

- [Civilization VI — Loyalty](https://civilization.fandom.com/wiki/Loyalty_(Civ6)) — cities flip to
  free cities at zero loyalty under neighbouring pressure; pressure scales with nearby population and
  distance.
- `docs/superpowers/specs/2026-07-20-province-sea-lanes-design.md` — the expedition mechanic this
  pairs with.
