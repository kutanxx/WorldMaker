# Army-conquest prototype (levy → march → battle) — design

Date: 2026-07-25
Status: PROTOTYPE. Throwaway-tolerant, playable, NOT production. Existing `playProvince` untouched.

## Why this exists

The deployed province game is turn-based conquest where the player picks provinces to attack. After
playing it, the user's verdict was: *"간단한 것 같은데 복잡한 느낌이고, 여러모로 귀찮다"* — and, more
fundamentally, *"이 턴제 정복 자체가 내가 기대한 게 아니다"*. The reference points they named were
Europa Universalis / Crusader Kings / Hearts of Iron / Victoria.

The four concrete frictions they identified:
1. Re-scanning every turn for "where can I attack?"
2. Arming targets one at a time
3. Picking a conquer/consolidate stance every turn
4. Empty turns with nothing winnable (measured: 50–60% of turns under attacking policies)

Root cause: *"can I take this province?"* is an opaque formula (cohesion / distance / solidarity) that
the UI makes the player re-interrogate every turn. The player ends up hand-executing an algorithm the
engine already knows. The world's richness (biomes, towns, cultures) is barely used — provinces are
just nodes in a graph.

**This prototype replaces the question with a resource the player builds and can see.** "Can I take it?"
becomes "do I have more men there than they do?" — a number the player created and controls. That kills
all four frictions structurally, not cosmetically.

**It answers exactly one question: is this loop fun to do, turn after turn?** Everything not needed to
answer that is out of scope.

## The loop

Each turn the player:
1. **Levies** men from owned provinces (population drops)
2. **Moves** armies to adjacent provinces (own land = march, enemy land = battle)
3. Ends the turn → battles resolve, population regrows, AI does the same

Every turn has three real decisions — where to levy, where to march, strike now or mass more — and none
of them require scanning the map for permission.

## Population — derived from the generated world

`Province` already carries `cells` and `biome`; `world.cities` gives town locations. Population is
derived from them, so the world generator finally feeds the game:

```
basePop(province) = province.cells × BIOME_POP[province.biome] × (1 + 0.5 × citiesIn(province))
```

`BIOME_POP` (see table below). Population is a live value per province, capped at `basePop`, and is the
single resource: it is what you levy from and what conquest wins you.

## Terrain — population and defensibility move in OPPOSITE directions

Defence multipliers are centred so that open ground FAVOURS THE ATTACKER (below 1.0), not merely
"no bonus". Without this, defence always pays and the game stalemates.

| Biome | `BIOME_POP` | `BIOME_DEF` | Character |
|---|---|---|---|
| `GRASSLAND` | 1.0 | **0.85** | Rich AND easy to take — the prize everyone fights over |
| `DESERT` | 0.3 | 0.9 | Open, poor — easy to sweep, not worth much |
| `TUNDRA` | 0.3 | 1.0 | Empty frontier |
| `TROPICAL` | 0.7 | 1.15 | Populous, slow going |
| `TEMPERATE_FOREST` | 0.8 | 1.2 | The solid middle |
| `TAIGA` | 0.5 | 1.2 | Thin buffer |
| `WETLAND` | 0.5 | 1.35 | Poor, but the marsh is a wall |
| `ALPINE` | 0.25 | 1.6 | Almost no one lives there; a few hold off many |

This single table gives the map its drama: the fertile plains are worth taking and hard to hold, the
mountains are safe and worthless. Where wars happen becomes a property of the terrain, not of a formula.

## Levy

- A levy takes up to `LEVY_FRAC` (0.2) of a province's CURRENT population and turns it into men in an
  army standing on that province. Population drops by exactly that amount.
- Regrowth: each turn every province regains `REGROW_FRAC` (0.03) of its `basePop`, capped at `basePop`.
- So over-levying hollows a province out for many turns. War costs land, not an abstract score.

## Armies

- One army stack per (province, nation): `{ prov, nation, men }`. No unit types, no generals.
- Move = to a LAND-adjacent province (reuse `buildProvinceAdj`). One move per army per turn.
- Moving into own/empty-of-enemy land is a march (no battle). Moving into a province held by another
  nation triggers a battle.
- **Upkeep (`UPKEEP_FRAC` 0.03):** every army loses 3% of its men each turn it exists. Massing a
  doomstack and sitting on it bleeds it away — you must use an army or lose it. This is the prototype's
  main anti-turtle force, and it is an *incentive*, not a mechanical cap (the repo's four failed
  anti-turtle levers were all mechanical caps; the two that worked were incentives).

## Battle

The defender's strength is the enemy army standing on that province PLUS a small militia the population
itself raises, so a populous province is never free to walk into and terrain always matters:

```
militia  = floor(province.population × MILITIA_FRAC)     // MILITIA_FRAC = 0.05
atk      = attacker.men
def      = (enemy army men on that province + militia) × BIOME_DEF[target.biome]
attacker wins iff atk > def
```

Militia is not a standing unit — it is computed at battle time from the province's current population,
so a province hollowed out by over-levying really is defenceless, and a rich untouched one is not.

Losses (both sides bleed; overwhelming force is cheap, a close fight is ruinous):
- Loser: destroyed (all committed men lost). Militia losses come off the province's population.
- Winner: loses `round(loserEffective × 0.6)` men, floored at 0, capped at its own size − 1.
- A province with neither an army nor population (fully hollowed) is occupied with no losses — but an
  army still has to march in.

On a win the province changes owner. **Its population comes with it and is levyable next turn** — this
is the reward that makes attacking compound while turtling stands still.

## Turn order

1. Player issues levies and moves (any number, any order, all previewed before committing)
2. `endTurn()`: resolve player battles → AI nations levy/move/battle → apply upkeep → regrow population
3. Turn counter increments

Deterministic and rng-free, like the rest of the engine (same seed → same game).

## AI (deliberately dumb)

Enough to make the world push back, no more: each AI nation levies from its most populous safe province,
and marches its biggest army at the weakest adjacent enemy province it can beat. No diplomacy, no
planning. If the prototype is fun, the AI gets real work later.

## Victory conditions — NONE

Free play with a turn counter. The question under test is "is the loop fun", not "is the win condition
tuned". Adding a win condition now would bias the answer and waste work if the loop fails.

## UI — minimum viable, ugly is fine

- Map: provinces filled by owner. Each province labels its **population**; a province with an army also
  shows **men**. That's the whole information model — no hidden formula to interrogate.
- Click own province → levy button (shows men gained / population cost).
- Click own army → adjacent provinces highlight → click one to march/attack. A one-line preview shows
  `atk vs def×terrain` and the predicted outcome, so the terrain rule is legible.
- "End turn" button. A short log of what happened (battles, losses, captures).
- Side readout: my total population, my total men, turn number.

No stance buttons, no target-arming, no threat panels. Two clicks per action.

## Scope

- **New engine:** `src/engine/armySim.ts` — population, levy, armies, movement, battle, upkeep, regrowth,
  AI, `endTurn`. Pure and rng-free; unit-tested.
- **New page:** `playArmy.html` + `src/ui/armyApp.ts` — the minimal UI above.
- **Reused unchanged:** world generation, `Province`/`provinceOf`, `buildProvinceAdj`, biome data, map
  rendering helpers.
- **Untouched:** `src/engine/provinceSim.ts`, `src/ui/provinceApp.ts`, `playProvince.html`, all existing
  goldens and the 716 existing tests. The deployed game stays exactly as it is — it is the fallback and
  the comparison.

## Constants (all tunable in one block)

```
LEVY_FRAC    = 0.2    // max share of a province's population one levy takes
REGROW_FRAC  = 0.03   // share of basePop regained per turn
UPKEEP_FRAC  = 0.03   // share of an army lost per turn
MILITIA_FRAC = 0.05   // share of a province's population that defends it at battle time
WIN_LOSS_MULT= 0.6    // winner's losses as a share of the loser's effective strength
CITY_BONUS   = 0.5    // population multiplier added per city in the province
```

## Testing

- Pure-function unit tests: `basePop` derivation (biome + cells + cities), levy caps and population
  drop, regrowth cap at `basePop`, upkeep drain, battle verdicts across terrain (notably that grassland
  favours the attacker at 0.85 and alpine defends at 1.6), loss arithmetic on both sides, capture
  transferring population, adjacency-only movement.
- Determinism: same seed + same command sequence → identical state.
- One jsdom smoke test: mount, levy, march into an enemy province, end turn, assert the capture and the
  population/men readouts.

## Honesty / risks

- **This is a hypothesis, not a plan for a finished game.** It exists to be played by the user and judged.
  If the loop is dull, it is cheap to discard — nothing production depends on it.
- **Snowball risk:** conquest compounding (captured population is levyable) can let one nation run away.
  That is the first dial to turn if it happens; army upkeep partially offsets it because bigger armies
  bleed more in absolute terms.
- **Turtle risk is explicitly designed against** (attacker-favouring open terrain + upkeep + conquest
  reward), because this repo has already lost four rounds to that failure mode.
- The prototype deliberately has no victory condition, no diplomacy, no unit types, no supply lines. If
  the loop proves fun, those are the next conversation — not this one.
