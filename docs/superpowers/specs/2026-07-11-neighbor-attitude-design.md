# Neighbor Attitude — honest 3-state diplomacy readability (TW/Paradox benchmark)

**Date:** 2026-07-11
**Status:** Approved design (bundle ②)

## Why

User (07-08c): "나라들이 10년마다 전쟁 — 누가 위험한지 모르겠다". Benchmarks: **Total War / Paradox** attitude icons whose tooltips itemize the REASONS (the pattern's credibility), and the **Civ VI agendas failure** (displayed personality that behavior doesn't back reads as a lie). Constraint: show ONLY facts derived live from the sim that genuinely predict behavior.

## Derivation (read-only, no engine change)

New pure helper in `src/engine/standing.ts` (same home as `computeStanding`):

```ts
export type Attitude = "friendly" | "wary" | "hostile";
export interface NeighborAttitude {
  id: number; name: string;
  att: Attitude;
  ratio: number;        // their cells / player cells (aggregate)
  borderEdges: number;  // frontEdges vs this polity (threat + push)
  truceLeft: number;    // ticks remaining, 0 if none
  hegemon: boolean;     // dilemmaFlags has `hegemonFoe:<id>` and arc not done
}
export function neighborAttitudes(s: SimState): NeighborAttitude[];
```

Attitude rule — each state maps to a REAL behavioral guarantee:
- `friendly` = truce active (`truceLeft > 0`) — the engine literally skips their attacks on the player.
- `hostile` = no truce AND (`ratio >= ATT_HOSTILE_RATIO = 1.15` OR `hegemon`) — bigger neighbors win contests (contest math), and the flagged hegemon is the crisis foe.
- `wary` = everything else (bordering, no truce, not stronger — can nibble but not overrun).

Built on `hostileNeighbors(s)` (already excludes free cities) + `frontEdges` counted per polity via `s.owner[e.enemy]` (**cell index — map through owner**, the known gotcha) + `aggregate`. Sorted by `borderEdges` desc. NOT shown: anything requiring memory the sim doesn't keep (grudges from past attacks — deferred until the engine records them; showing them now would be fiction).

## UI (playApp.ts)

- **Neighbor strip:** a `.neighbors` row in the panel directly under the threat line — one `.neighbor-chip` per entry, capped at `NEIGHBOR_SHOW = 6` (overflow "+N"): attitude icon 🤝(friendly, green) / 👁(wary, amber) / ⚔(hostile, red) + name. The 07c clutter lesson: chips are one compact row, no new panel.
- **Reason tooltip** (the TW/Paradox pattern) — each chip's `title`, factor per line, only TRUE facts:
  - `국경 {borderEdges}칸 접촉` / `borders you on {n} edges`
  - `국력 x{ratio}` (1자리 반올림) — `우세`/`열세`/`비등` word
  - truce: `휴전 {truceLeft}턴 남음` else `휴전 없음`
  - hegemon: `⚠ 패권국 — 위기의 상대`
- **Peace select icons:** `renderActions`' peace `<option>` text gains the attitude icon prefix (`⚔ Nianthael` / `🤝 Kordu ✓`) so suing for peace is an informed pick — reuses the same `neighborAttitudes` call.
- Threat-line counts stay (chips complement, not replace). Recompute on every render (pure, cheap).
- i18n: all strings KO/EN (`attFriendly/attWary/attHostile`, factor templates).

## Non-goals

Bot behavior driven by attitudes (real agendas — engine work, later); grudge memory; a diplomacy screen; map recoloring by attitude (front lines already carry the spatial signal).

## Testing

1. `neighborAttitudes` unit: truce → friendly regardless of ratio; ratio ≥1.15 → hostile; hegemonFoe flag → hostile; free cities absent; borderEdges counted per polity (fixture with two enemies); sorted desc; read-only (owner/solidarity snapshots unchanged).
2. playApp DOM: chips row present with ≤6 chips; a chip's `title` contains the ratio and truce line; peace options carry icons; making peace flips that chip to 🤝 next render.
3. Full suite (goldens untouched — helper is read-only).

## Sources

- [Total War: Warhammer — attitude tooltips itemize factors](https://totalwarwarhammer.fandom.com/wiki/Diplomacy)
- [Civ VI agendas reception — the honesty constraint](https://forums.civfanatics.com/threads/agendas-are-making-a-return-yay-or-nay.692131/)
