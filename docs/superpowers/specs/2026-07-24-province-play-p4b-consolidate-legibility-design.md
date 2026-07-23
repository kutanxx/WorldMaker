# Province play P4b: consolidate legibility (design)

Date: 2026-07-24
Scope: `playProvince.html` (province game), consolidate stance + conquer preview. UI display only.

P4b of the playtest-driven improvement set. A playtest complaint: *"consolidating doesn't
visibly raise stability, and I don't get why I'd attack vs consolidate."* This is the
lightweight cut (agreed with the user): make consolidate's **effect** visible and make its
**purpose** legible, WITHOUT the strict "consolidating this front opens that target"
predictor (deferred). No engine change; golden hashes untouched.

## Problem

1. **Consolidating shows no visible effect.** The engine raises a consolidated province's
   solidarity by `CONSOLIDATE_BONUS` (0.1) and stops its unrest clock, but nothing on
   screen shows the gain — the solidarity wash lightens only ~0.12 opacity, imperceptibly.
   The player cannot tell their action did anything.
2. **The "consolidate opens an attack" causal link is buried.** The conquer-mode battle
   line already says `· 🛡 내실하면 뚫림` / `· consolidate to break through` for a
   too-strong-but-`breakable` target, but it is plain text at the end of a dense line and
   reads as an afterthought. The player does not connect "this red target" to "build up and
   it opens".

## Non-goals

- **No strict per-front predictor.** "Consolidating THIS province opens THAT target next
  turn" (a `forecastIncoming`-style deterministic check) is explicitly deferred — this cut
  uses the existing `breakable` flag only. `breakable` means "a fully cohesive realm could
  take this", i.e. "building up opens it eventually", which is honest but not "one
  consolidate turn opens it". The copy must match that meaning (see below).
- **No engine change.** `explainAttack`, its `breakable` flag, `CONSOLIDATE_BONUS`, and the
  golden hashes (init `226648593`, 50-tick `2503300448`, player path `2374466985`, Version A
  `1350115163`) are untouched.
- **No B2 (conquer-mode map marks for openable targets)** — the user explicitly deferred it.
- No balance change (that is P4c, measurement-first).

## Design

### 1. Show the stability gain when consolidating (the effect)

In consolidate mode, a province the player has SELECTED to shore up shows its stability
before → after on its `<title>` and, more visibly, as a small map label near its centroid:

`안정도 55% → 65%` / `stability 55% → 65%`

where `after = min(1, provSol + CONSOLIDATE_BONUS)`, rounded to whole percent. This is the
consolidate contribution shown at the moment of choosing — consistent with the project's
"preview the result at decision time" line (P2 forecast, P3 margin). It is honest: it shows
exactly the `CONSOLIDATE_BONUS` the engine will add. (The net next-turn solidarity also
includes the frontier-rise / interior-decay step, so the label is explicitly about the
consolidate contribution, labelled as such, not a promise of the net.)

A pure exported helper carries the arithmetic so it is testable and cannot drift:

```
export function consolidatedStability(sol: number): number   // = min(1, sol + CONSOLIDATE_BONUS), as a %? 
```

Return the after-value in [0,1]; the UI rounds both current and after to whole percent for
display. `CONSOLIDATE_BONUS` is not exported from the engine; the helper re-declares `0.1`
locally with a comment that it must match the engine (a UI-only display value — it never
feeds a contest, so a drift would only mis-label, and a test asserts the two agree by
construction).

Only SELECTED consolidate provinces get the `→` label (an unselected candidate showing a
projected gain would clutter every owned province). The existing `🛡 지켜짐 / protected`
title (P2) takes precedence when it applies — a protected province shows the shield message;
a selected-but-not-protected province shows the stability `→` label; an unselected province
keeps its plain `name — stability N%` title.

### 2. Make the "consolidate to break through" cue prominent (the purpose)

In the conquer-mode battle preview, the trailing `breakable` cue is lifted from buried
plain text to a distinct, leading marker on the row so the player connects a too-strong
target to "build up and it opens":

- A `breakable` too-strong row gets a `🔓` prefix marker (or a `.breakable` class the CSS
  styles distinctly) and the phrasing stays accurate to `breakable`'s meaning: `🔓 내실로
  힘을 키우면 뚫려요` / `🔓 build up your strength to break through` — "eventually", not
  "one turn". A non-breakable too-strong row keeps `지금은 벅참 (상대가 약해지길)` / `too
  tough for now (wait for it to weaken)`.
- No new computation — `explainAttack(...).breakable` already distinguishes the two cases;
  this is purely how the existing flag is presented.

### 3. dead-turn relief (a consequence, not new code)

Making #2 prominent means an all-hatched conquer turn (measured 56% of conquer turns) now
reads "these can be opened by building up" rather than a dead end — pairing with the
existing empty-state notice ("consolidate to build up strength"). No extra code beyond #2.

## Files

- `src/ui/provinceApp.ts` (`fortifyOverlay` title/label for the stability `→`; the
  conquer-preview `breakable` row marker; a small exported `consolidatedStability` helper)
- `src/theme.css` (a `.prov-fortify-gain` map label style; a `.prov-preview-row.breakable`
  accent)

## Tests

1. `consolidatedStability(sol)` returns `min(1, sol + 0.1)`: e.g. `0.55 → 0.65`, and clamps
   (`0.95 → 1.0`, `1.0 → 1.0`).
2. In consolidate mode, a SELECTED province shows a `안정도 X% → Y%` label/title where
   `Y = round(consolidatedStability(sol)*100)` and `X = round(sol*100)`; an UNSELECTED
   province does not show the `→` label.
3. The P2 `🛡 protected` title still wins for a selected+protected province (precedence), so
   that behaviour is not regressed.
4. A conquer-mode battle-preview row for a `breakable` too-strong target carries the
   `🔓` marker / `.breakable` class and the "build up to break through" copy; a
   non-breakable too-strong row does not (it keeps "too tough for now").
5. Both new strings have ko + en forms.

## Verification (live browser)

In consolidate mode, select a province and confirm the `안정도 X% → Y%` reads correctly
(Y = X + 10, clamped at 100), and that a protected province still shows the shield. In
conquer mode with an all-hatched turn, confirm the `🔓` "build up to break through" marker
is prominent on breakable rows and absent on non-breakable ones. Screenshots are
harness-blocked, so whether it now "feels" like consolidate does something is the user's
call — report the exact strings.
