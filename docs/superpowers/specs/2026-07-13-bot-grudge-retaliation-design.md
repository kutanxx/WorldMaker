# Bot Grudge Retaliation — Design

**Date:** 2026-07-13 · **Scope:** engine (`historySim.ts` contest sites, `standing.ts` attitude) + tests. No UI changes. **Origin:** backlog 🅰④ — the UI has claimed since 07-11c that bots hold grudges ("내가 침공했음 · 원한" chip factor), but `attacksByPlayer` is write-only for the sim: bots never act on it. This feature makes the displayed grudge TRUE, completing the Civ VI grievances loop (grudge → consequence → decay).

## Mechanics

### 1. Revenge multiplier at every contest site (`historySim.ts`)

A bot that the player struck within the grudge window attacks the PLAYER'S cells harder:

- `export const REVENGE_MULT = 1.2;` (initial; see Calibration) and a helper near the contest code:

```ts
// revenge (play only): a polity the player struck within the grudge window hits back harder
// at PLAYER cells. Callers are inside playerPolity>=0 gates — the o===-1===playerPolity
// pure-path trap never reaches this.
function revengeMult(s: SimState, attacker: number): number {
  const t = s.attacksByPlayer.get(attacker);
  return t !== undefined && s.tick - t < GRUDGE_TICKS ? REVENGE_MULT : 1;
}
```

- `GRUDGE_TICKS` is defined in `historySim.ts` and re-exported from `standing.ts` (single source with the engine — the chip stops saying 원한 exactly when the sim stops acting on it).
- Application, at ALL THREE contest sites, only on the player-defending branch:
  - Land (~line 306-309): inside the existing `if (s.playerPolity >= 0)` block, `if (o === s.playerPolity) { def *= STANCE_DEF_MULT[s.stance]; atk *= revengeMult(s, best); }`
  - Strait (~line 339-340): same pairing on the `o === s.playerPolity` branch (`atk *= revengeMult(s, best)`).
  - Sea lane (~line 359-360): same (`atk *= revengeMult(s, p)`).
- Target SELECTION (strongest-neighbor pick) is unchanged — revenge is a strength story, not a pathfinding story. Truces still block contests against the player entirely, so the loop reads: attack → grudge → they hit back harder for 5 turns, unless you buy peace.
- The player's own attacks (`best === s.playerPolity`) are never multiplied — revenge is asymmetric by design (bots don't grudge each other; the pure path must stay byte-identical and bot-vs-bot history is shared with Version A).

### 2. Honest attitude flip (`standing.ts` `neighborAttitudes`)

`iAttackedAgo` is currently display-only (wary + a factor line). Since the bot now genuinely prefers hitting back, a fresh `iAttacked` promotes the attitude to **hostile** (same tier as `attackedMe`), decaying back with `GRUDGE_TICKS` as today. The factor line (`factIAttacked*`) is unchanged — the chip's color/tier now matches the sim's actual behavior. Existing hostile causes (attackedMe, ratio ≥ 1.15, hegemonFoe) unchanged.

## Calibration (measured, not guessed — the stance-retune method)

Acceptance sweep (a throwaway probe script or test-side measurement, documented in the plan):

1. **Revenge is real:** across ≥10 full-size seeds, run pairs of 10-tick windows from the same mid-game state — one where the player attacked a neighbor 1-3 times first (grudge fresh), one clean. The grudge-holding polity must take measurably more player cells in the grudge window (nonzero median uplift).
2. **Pacifists unharmed:** a no-attack internal-stance run must produce byte-identical owner evolution with the feature on vs off (no grudge ⇒ multiplier is always 1 — this should hold by construction; the sweep confirms no accidental coupling).
3. **Aggression stays viable:** aggressive runs may lose more border cells but must not become unplayable — eyeball the sweep numbers; if revenge dominates stance identity, drop to the pre-authorized levers **1.15**; if invisible, raise to **1.3**.

## Determinism / constraints

- Pure path byte-identical: the multiplier only executes inside `playerPolity >= 0` gates, and `attacksByPlayer` is empty on the pure path anyway (defense in depth). Golden FNV hash tests must pass untouched.
- `GRUDGE_TICKS` import direction: `historySim.ts` ← `standing.ts`. Verify no import cycle (standing already imports from historySim — if it does, move `GRUDGE_TICKS` into `historySim.ts` and re-export from `standing.ts` so the UI's import sites stay valid).
- Verbatim advance handler untouched; no UI files change.

## Testing

- **Engine (playSim/historySim tests):** stage a fixture where a grudge-holding neighbor's contest against a player cell falls between `def·THRESH` and `def·THRESH/REVENGE_MULT` — flips to captured only with the grudge (and confirm the same contest WITHOUT the grudge entry does not flip). Follow the repo's staging gotchas: raise the ENEMY side's solidarity to create the threat, shrink margins by carving neighbors AND straitLinks. Second test: advance past `GRUDGE_TICKS` and confirm the multiplier expires.
- **standing.test.ts:** fresh `iAttacked` ⇒ `att === "hostile"`; after `GRUDGE_TICKS` ⇒ falls back (wary/friendly per other factors). Existing attackedMe-hostile tests unchanged.
- **Golden hashes:** untouched (pure path).
- **Sweep:** run once during implementation, paste numbers into the plan/report; not a permanent test (seed-sensitive).

## Rejected alternatives

- **Target-selection bias toward the player** — dramatic but over-engineered before the sweep says the strength multiplier is invisible; selection currently picks the strongest neighbor per cell and biasing it entangles two systems.
- **Revenge event card** — separate scope (dilemma system), and the grudge already surfaces via chips.
- **Stacking grudge counts** — single timestamp + decay is the deliberate Civ VI lesson (07-11c); stacking reintroduces the grievance-spiral problem.
- **Bot-vs-bot grudges** — would alter the shared pure-path history and Version A byte-identity; out of the question.
