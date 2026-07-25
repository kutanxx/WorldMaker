# Army prototype — tension pass (odds, costly defence, nation choice) — design

Date: 2026-07-25
Status: PROTOTYPE iteration. Builds on `2026-07-25-army-conquest-prototype-design.md`.
Scope: `src/engine/armySim.ts` + `src/ui/armyApp.ts` only. The deployed province game stays untouched.

## What the play-test found

Three games (25 turns each, two worlds, aggressive and turtle policies):

| Game | World | Policy | Trajectory | Battles | Dead turns |
|---|---|---|---|---|---|
| 1 | seed 11 | aggressive | 29 → 50 | 52 | 3/25 (12%) |
| 2 | seed 23 | aggressive | 18 → 42 | 68, **0 defeats** | 0/25 |
| 3 | seed 23 | turtle | 18 → 16, then frozen 20 turns | 0 | — |

**Fixed by the prototype:** the original complaint is genuinely gone. Dead turns fell from the old
game's 50–60% to 0–12%; every turn has something to do; battle costs vary (4–197) so cheap raids and
expensive grinds read differently.

**Three problems the play-test exposed:**

1. **No risk at all.** 68 battles, zero defeats. `previewMove` is exact, so a competent player simply
   never attacks unless the answer is already "win". The attack decision is solved arithmetic, not a
   gamble — which is the same class of complaint the user had about the old game ("the engine already
   knows; I'm just executing it by hand"). This is the most important finding.
2. **Monotone snowball.** 29→50 and 18→42 with essentially no setbacks. Conquest compounds
   (captured population is levyable) and nothing pushes back hard enough to reverse it.
3. **Turtling is safe.** The spec pre-registered "defence is free" as the risk to watch, and it landed:
   a turtle loses two provinces and then nothing happens for twenty turns. Nothing forces the issue.

Plus one structural gap: **the player cannot choose a nation** — `mountArmyApp` auto-picks whichever
nation starts with the most provinces.

## The three changes

### 1. Battle odds — uncertainty WITHOUT losing determinism

The engine stays reproducible: the same seed and the same commands must still produce an identical game
(the whole test suite depends on it). So the roll is **not** `Math.random()` — it is a pure hash of the
battle's identity:

```
roll(s, target, attacker) = hash01(worldSeed, s.turn, target, attacker)   // in [0,1)
```

`hash01` is a small deterministic integer hash (the repo already has `mulberry32`/`deriveSeed` in
`src/engine/rng.ts` — reuse `deriveSeed`-style mixing rather than inventing a new one). Because it is
keyed by `(turn, target, attacker)`, two different attacks in the same turn get different rolls, and
replaying the same game reproduces every outcome exactly.

Win probability comes from the strength ratio, sharpened so that overwhelming force is nearly safe and
an even fight is a coin flip:

```
p = atk^ODDS_K / (atk^ODDS_K + def^ODDS_K)        // ODDS_K = 3
attacker wins iff roll < p
```

With `ODDS_K = 3`: `atk = 2×def` → 89%, `atk = 1.5×def` → 77%, `atk = def` → 50%, `atk = 0.5×def` → 11%.
So a 3:1 attack is close to a sure thing and a marginal attack is a real gamble — the decision the
prototype is missing. `atk` or `def` of 0 is handled by the formula's limits (`def = 0` → p = 1).

**The preview stops promising and starts quoting odds.** `BattleResult` gains `p: number`, and the UI row
becomes `공격 154 vs 방어 76 · 유리 (89%)` instead of `승리 예상`. It is still incapable of lying — it
reports the exact probability the engine will roll against, and `previewMove`/`moveArmy` keep sharing
one `resolve`.

Losses scale with how close the fight was, so a narrow win is bloody and a rout is cheap. Replace the
flat `round(def × WIN_LOSS_MULT)` with:

```
winner's losses = round(loserStrength × WIN_LOSS_MULT × closeness)
  where closeness = min(atk, def) / max(atk, def)     // 1.0 for an even fight, → 0 for a rout
```

### 2. Defence is no longer free

Today a repelled attack costs the defender nothing, which is why turtling is safe. On a **failed**
attack the defender now also bleeds:

```
defender's losses = round(atk × DEF_LOSS_MULT)        // DEF_LOSS_MULT = 0.35
```

taken from the defending ARMY first; any remainder comes out of the province's POPULATION (the militia
that died). Population floors at 0. So holding a border under repeated assault grinds the province
down even when every assault fails — a turtle bleeds, and an attacker who cannot win outright can still
wear a fortress down. This is the single lever the previous spec pre-registered for exactly this
symptom, and the play-test confirmed the symptom.

### 3. Choose your nation

A picker before the game starts, mirroring the province game's existing pattern: the map renders with
every nation clickable, and a legend line lists what you are choosing between. Clicking a nation starts
the game as that nation.

Each nation's entry shows its **province count and total population**, so "small and poor" versus "large
and rich" is a visible choice rather than a hidden one. No recommendation marker — the whole point is to
let the user try a small nation, which the play-test could not do.

## Constants added

```
ODDS_K         = 3      // sharpness of the odds curve (higher = big advantages matter more)
DEF_LOSS_MULT  = 0.35   // defender's losses on a repelled attack, as a share of the attacking force
```

`WIN_LOSS_MULT` (0.6) is retained but is now multiplied by `closeness`.

## What this does NOT change

- The economy (levy, upkeep, regrowth, population from the world) — the play-test showed it working.
- Terrain tables — the map already drives where fighting happens.
- One-move-per-army-per-turn.
- No victory condition. Still free play.
- The deployed province game, its engine, and every existing test.

## Testing

- `hash01`/roll: deterministic for the same inputs, differs across `(turn, target, attacker)`, stays in
  [0,1).
- Odds: `p` is 0.5 at parity, rises monotonically with `atk/def`, ≈0.89 at 2:1, and is 1 when `def = 0`.
- A battle whose `p` is below the roll now LOSES even though `atk > def` — the point of the change.
- `previewMove` still shares `resolve` and still never mutates; its reported `p` is exactly what
  `moveArmy` rolls against (assert by running both on the same state and comparing).
- Losses: an even fight costs the winner materially more than a rout does.
- Failed attack: the defending army shrinks, and once it is gone the province's population absorbs the
  rest, floored at 0.
- Picker: every alive nation is clickable and shows province count and population; clicking starts the
  game as that nation; the game's HUD then names it.
- Determinism end to end: same seed + same command sequence → identical final state.

## Honesty

- **This trades a design asset for tension.** The old preview was incapable of being wrong; the new one
  can say 78% and you still lose. That is the intended cost — a decision with no risk was not a
  decision. If the user dislikes it, reverting is a one-line change (`p` → `atk > def ? 1 : 0`).
- **Snowballing is only partly addressed.** Odds and costly defence make expansion riskier and turtles
  bleed, but conquest still compounds. If a runaway persists in the next play-test, the dial is the
  conquest reward (captured population), not these two.
- The odds curve `ODDS_K = 3` is a guess calibrated to make 3:1 safe and 1:1 a coin flip. It is one
  constant and expected to be retuned after the next play-test.
