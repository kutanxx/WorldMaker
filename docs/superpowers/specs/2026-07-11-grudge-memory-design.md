# Grudge Memory — bilateral attack history feeding neighbor attitudes (Civ VI Grievances benchmark)

**Date:** 2026-07-11
**Status:** Approved design

## Why

The attitude tooltip's missing "most human" factor: who attacked whom. Benchmark: **Civ VI Gathering Storm's Grievances**, which replaced the hated warmonger system and was praised for exactly two properties we adopt: (1) **bilateral** accounting — both sides' transgressions recorded, so "he started it" has merit; (2) **decay** — grievances fade with time. Deferred from the attitude v1 because the engine kept no attack history.

## Engine — two play-gated SimState fields (the truces/foundedCities precedent)

```ts
attacksOnPlayer: Map<number, number>; // polityId -> last tick it took player cells; play only
attacksByPlayer: Map<number, number>; // polityId -> last tick the player took its cells; play only
```

Initialized empty in `initSim`. NEVER touched on the pure-history path — golden hashes byte-identical.

**Recording sites (3):**
1. `stepSim` land-contest loop and strait-contest loop, where `nextOwner[c] = best` fires:
   - `if (s.playerPolity >= 0 && o === s.playerPolity) s.attacksOnPlayer.set(best, s.tick)`
   - `if (s.playerPolity >= 0 && best === s.playerPolity && o >= 0) s.attacksByPlayer.set(o, s.tick)`
   - ⚠ The explicit `s.playerPolity >= 0` gate is LOAD-BEARING: on the pure path `playerPolity` is −1 and unclaimed cells have `o === -1`, so `o === s.playerPolity` would be TRUE for every unclaimed-land grab — without the gate the map fills on the pure path (behavior-invisible but a lie, and a Map allocation difference). The strait loop is already inside a play-gated block; the land loop is not.
2. `applyIntervention` attack success (intervention.ts, after `resolveCapture`): `s.attacksByPlayer.set(def, s.tick)`.
3. `resolveDilemma` hegemon3 (dilemma.ts): victory → `attacksByPlayer.set(foe, tick)`; rout → `attacksOnPlayer.set(foe, tick)`.

NOT recorded: civil-war partition and conquest annexation of third parties (internal collapse / not aimed at the player); a player elimination ends the game anyway.

## Attitude integration (standing.ts)

- `export const GRUDGE_TICKS = 5;` (50y decay window — the Civ VI decay lesson).
- `NeighborAttitude` gains `attackedMeAgo: number | null; iAttackedAgo: number | null` — ticks since the event if `< GRUDGE_TICKS`, else null (expired = gone, not shown).
- **Hostile condition extends**: `hostile = no truce AND (ratio ≥ ATT_HOSTILE_RATIO OR hegemon OR attackedMeAgo !== null)`. Honest: a polity that just took player cells has PROVEN local contest superiority. Truce still overrides everything (engine guarantee).
- `iAttackedAgo` is DISPLAY-ONLY (a tooltip line), never flips attitude — bots don't retaliate yet, and displaying vengeance the sim doesn't back is the Civ-agendas lie. (Bot retaliation = the future "real agendas" step.)

## UI (playApp.ts tooltip lines, chips/select unchanged otherwise)

Two optional factor lines appended to the chip tooltip:
- `attackedMeAgo !== null` → `⚔ 최근 나를 침공 ({n}턴 전)` / `⚔ attacked you {n} turns ago` (n=0 → "이번 턴"/"this turn": template `factAttackedMe`, with `factAttackedMeNow` for 0).
- `iAttackedAgo !== null` → `내가 침공했음 ({n}턴 전) · 원한` / `you attacked them {n} turns ago · grudge` (`factIAttacked`/`factIAttackedNow`).
i18n KO+EN.

## Non-goals

Bot behavior driven by grudges (retaliation targeting); grudge SCORE accumulation (Civ's numeric score — we keep a last-tick timestamp, enough for a 3-state display); persistence across reigns; showing expired grudges.

## Testing

1. Engine: pure-history run (playerPolity −1) leaves both maps EMPTY (the gate test) + full-suite golden hash green; play-mode stepSim capture of a player cell records the taker; player `applyIntervention` attack records the defender; hegemon victory/rout record their directions.
2. standing: fresh attack → `attackedMeAgo: 0` and attitude hostile even for a weaker polity (engineer: set `attacksOnPlayer` directly); tick beyond GRUDGE_TICKS → null and attitude reverts; truce still wins over a fresh grudge.
3. playApp DOM: seeded `attacksOnPlayer` → chip tooltip contains the attacked-me line.

## Sources

- [Civ VI Grievances — Civilization Wiki](https://civilization.fandom.com/wiki/Grievances_(Civ6))
- [CivFanatics — Grievances guide (decay, bilateral)](https://forums.civfanatics.com/threads/grievances-guide.642164/)
