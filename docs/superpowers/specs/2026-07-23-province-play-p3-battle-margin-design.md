# Province play P3: battle line as a single margin (design)

Date: 2026-07-23
Scope: `playProvince.html` (province game), conquer stance. UI display only.

P3 of the playtest-driven improvement set (P1, P2 shipped). This closes B0 from the user's
playtest brief — the attack forecast can display a NEGATIVE attack strength — and takes the
fix one step further, from "hide the negative" to "make the whole battle line readable".

## Problem

The battle-preview line and target tooltips read:

> `⚓ the Bitter Pinewood — ⚔ -5 vs 🛡 17 · too strong (far from your capital)`

Two problems:

1. **A negative attack number is shown.** `od.atk` is `strength(...) × mult`, and
   `strength` has no floor — the distance term `−W_DIST × dist` can reach about −2.4 on the
   1000×700 map, so a far target renders `⚔ -5`. That is the literal, honest output of the
   formula, not a bug in the value — but a negative "attack strength" reads as nonsense.
2. **Even when both numbers are positive, the player must do the arithmetic.** `⚔ 66 vs
   🛡 50` requires computing `66 > 50 × 1.03` (including the 1.03 threshold) to know the
   outcome — the two raw numbers push the comparison onto the reader.

## Non-goals

- **No engine change.** `explainAttack`'s `atk` / `def` / `win` / `reason` are unchanged;
  the golden hashes (init `226648593`, 50-tick `2503300448`, player path `2374466985`,
  Version A `1350115163`) stay untouched by construction (only `attackLine` in
  `provinceApp.ts` changes).
- **Not a floor on `strength`.** Flooring the engine's strength at 0 would change contest
  outcomes at the margin and move the goldens — that is a balance decision, deferred to P4.
  P3 is display-only.
- The ✓/✕ verdict, the badge/hatch, and the reason text are unchanged.

## Design

Replace the two raw numbers with ONE signed contest margin, so the line reads the outcome
for the player instead of making them compute it, and the negative-attack display vanishes
as a side effect.

The real contest is `win = atk > def × CONTEST_THRESH` (`CONTEST_THRESH = 1.03`). Define the
margin as `m = atk − def × CONTEST_THRESH`, so **`m > 0` is exactly `win`** — the displayed
number can never disagree with the ✓/✕ verdict. This is the same "display is one with the
truth" principle as P1 (counter = win check) and P2 (forecast = reality).

New line format:

- win: `{name} — ⚔ 우세 +{mag} · 점령 가능 ({reason})` / `{name} — ⚔ ahead by {mag} · you can take ({reason})`
- loss: `{name} — 🛡 우세 +{mag} · 실패 ({reason})` / `{name} — 🛡 defender ahead by {mag} · too strong ({reason})`

where `mag = Math.max(1, Math.round(Math.abs(m) × 100))`.

### The one gotcha the design must pin (else B introduces a bug)

**The side (⚔ vs 🛡) MUST be taken from `od.win`, never recomputed from the rounded
`mag`.** Rounding `Math.abs(m) × 100` can produce 0 for a razor-thin margin; if the code
decided the side from "displayed number > 0" it would flip a thin win/loss and contradict
the ✓/✕. Taking the side from `od.win` (the real, unrounded verdict) makes contradiction
impossible. `mag` is floored at 1 so a decisive-but-tiny margin never prints "+0".

This keeps the through-line the reviewer can check in one line: the side comes from the
verdict, the magnitude is `|m|`, so the number and the badge/hatch/✓/✕ are provably
consistent.

### Scope of the change

`attackLine(u, prov)` in `src/ui/provinceApp.ts` is the single producer of this string — it
feeds both the battle-preview panel rows (`.prov-preview-row`) and the per-target `<title>`
tooltips, so changing it once fixes both surfaces. The trailing "🛡 consolidate to break
through" / "too tough for now" hint on a loss is unchanged.

The reason text (`reasonText`) is unchanged: on a far target it still reads "far from your
capital", which now correctly pairs with "🛡 defender ahead by N" instead of the nonsensical
"⚔ -5".

## Files

- `src/ui/provinceApp.ts` (only `attackLine`)

## Tests

1. A winning attack's line contains `⚔` with a `우세`/`ahead` magnitude, the `점령
   가능`/`you can take` verdict, and NO negative number.
2. A losing attack's line contains `🛡` with a `우세`/`ahead` magnitude and the `실패`/`too
   strong` verdict, and NO `-` before a digit (the negative-attack case is gone).
3. The side marker agrees with the verdict: for a sample of targets, the line shows `⚔`
   exactly when `explainAttack(...).win` is true and `🛡` exactly when it is false — pinned
   against `od.win`, so the string can never contradict the badge/hatch.
4. `mag` is floored at 1: a target whose `|m| × 100` rounds to 0 still prints `+1`, never
   `+0`. (Construct or find a razor-thin margin; if none is reachable, assert the floor via
   the pure helper below.)
5. Extract the pure margin/side formatting into a small exported helper so tests can pin the
   floor and the sign-from-verdict rule directly, e.g.
   `export function battleMargin(atk: number, def: number, win: boolean): { side: "atk" | "def"; mag: number }`
   returning `side` from `win` and `mag = max(1, round(abs(atk − def×CONTEST_THRESH)×100))`.
   Note: `CONTEST_THRESH` lives in the engine and is not exported; the helper takes the
   already-thresholded inputs, or re-declares the constant locally with a comment that it
   must match the engine's `CONTEST_THRESH` (a test asserts the two agree by checking `win`
   against `atk > def × THRESH` on a fixture). Prefer taking `win` as a parameter (as above)
   so the helper never re-derives the verdict.

## Verification (live browser)

Find a far target that previously showed `⚔ -5` and confirm it now reads `🛡 ahead by N`
with no negative number, and that its ✓/✕ and badge/hatch still match the side marker.
Confirm a winnable target reads `⚔ ahead by N`. Screenshots are harness-blocked, so the
final read is the user's, but the string content is fully checkable via the DOM.
