# Province play P4c (balance) — measurement phase (design)

Date: 2026-07-24
Scope: headless measurement only. NO engine change, NO golden re-pin, nothing merged.

P4c is the balance phase. This document covers ONLY its first, mandatory step: measure the
current balance precisely before deciding whether — and how — to change anything.

## Why measurement first (the central risk)

This repo has tried four mechanical balance levers blind (SIZE_CAP, fragile conquest,
WORLD_HARDEN, CONQUEST_SOL) and reverted all four after measurement. The recorded
meta-conclusion: *the engine is cohesion-driven, so mechanical anti-turtle levers get
adapted around; only incentive/framing (survival grading) and ATTACK_EXHAUST worked.*
Diving straight to a fifth lever risks a fifth failure. So P4c starts as pure measurement:
the data decides whether there is a fixable problem, which lever (if any) helps, and — a
valid outcome — whether the current balance should be left alone.

A controller played 13 live games this session and found: consolidate-only collapses,
dead-turns ~40%, domination 1/13 (only from a small start), size inversely correlated with
winning. That is a small, noisy, hand-run sample. This phase replaces it with a large,
precise headless sweep.

## The measurement (start size × strategy)

A throwaway headless script drives the engine directly — no UI. For each cell of a
`start-size × strategy` matrix it runs many seeds to completion and aggregates.

**Engine API used** (all exported, read-only to the engine — the script imports and calls,
it does not modify `src/engine/`): `generateWorld`, `initProvinceSim`, `stepPlayerTurn`,
`armableTargets`, `explainAttack`, `pAggregate`, `isDomination`-equivalent, `PROVINCE_SIM_TICKS`.

**Start-size buckets.** In a given world the 8 nations partition ~100 provinces, so start
sizes vary. Scan seeds, pick nations by starting province count into buckets: **small
(≤ ~8), mid (~9–15), large (≥ ~18)**. Record the actual counts; do not assume a fixed spread.

**Strategies (bot policies — deterministic, rng-free like the engine):**
- **aggressive** — each turn attack every winnable target (`armableTargets` ∩ `explainAttack.win`).
- **consolidate** — each turn shore up the 2 most-threatened owned provinces (or 2 palest).
- **mixed / smart** — attack winnable; if the capital is forecast-lost, consolidate to defend
  it; when nothing is winnable, consolidate the front of a `breakable` target (mirrors the
  P4b "build up then attack" tactic the controller's best live games used).

**Seeds.** 30–50 per cell (tune for runtime), same seed set across cells so differences are
attributable to the cell, not the seed draw.

## Metrics (per cell)

1. **Outcome distribution** — domination / survival-grade (great/grown/held) / defeat, as %.
2. **Size trajectory** — start → peak → end province count; does the realm collapse, stall,
   or grow? (Reproduce the brief's §2 trajectory shape, e.g. big-start 23→20→16→11.)
3. **Dead-turn fraction** — % of a game's conquer turns with zero winnable targets.
4. **Reachability of domination** — how often net gain hits `round(0.15 × land)`, by size.
5. **Strategy dominance** — does one strategy strictly win, and does that differ by start size?

## What this phase produces

A **diagnostic report** (recorded in the backlog memory + summarised to the user), answering:
- Is "size is a liability" real and how severe? (B1)
- Is domination genuinely unreachable, and for whom? (B3)
- Are dead-turns a balance problem or a pacing one? (my finding)
- Is small-nation bootstrap actually broken, or is small already fine/favoured? (B2 — the
  controller's live data suggested small is favoured, contradicting the brief)
- **Is there a fixable problem at all, or is the current resting point acceptable?**

No lever is chosen in this phase. If the data shows a clear, single, high-confidence lever,
a SEPARATE P4c-tuning spec follows (measure the lever the same way, adopt only if the
trajectory improves and non-static/golden constraints hold, re-pin goldens). If the data
shows the current balance is a reasonable resting point (the outcome the last four levers
reached), P4c concludes with "leave it, here's why" — also a success.

## Constraints & honesty

- **Throwaway.** The harness is a scratch script (in the scratchpad or a `__probe` test),
  deleted after the report. Nothing merged, no engine touched, goldens untouched.
- **Bots are proxies, not proof.** A bot policy cannot fully stand in for a skilled human
  (esp. the P4b build-up-then-strike timing). The sweep gives a DIRECTION signal, weighed
  against the controller's and the user's live play — never treated as absolute truth.
- **A "don't change it" conclusion is valid** and, given the repo's history, likely for at
  least some of B1/B2/B3.

## Verification

The harness's own faithfulness: its per-turn resolution must match `stepPlayerTurn` (it
calls it directly, so it does by construction). Spot-check a couple of cells against the
controller's live 13-game observations (consolidate-only collapses; small starts do better)
— if the headless sweep flatly contradicts live play, the bot policy is wrong, not the
engine; fix the policy before trusting the numbers.
