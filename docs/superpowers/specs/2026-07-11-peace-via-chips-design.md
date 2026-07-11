# Peace via Neighbor Chips — direct-manipulation diplomacy (Total War benchmark)

**Date:** 2026-07-11
**Status:** Approved design

## Why

User asked why the command bar's `강화 요청` dropdown exists. Research: the genre standard for
initiating diplomacy is **clicking the faction directly** in a relation-colored faction list
(Total War), and minimal-UI 4X praise centers on contextual "tap the object" actions (Polytopia).
Our neighbor attitude chips ARE a relation-colored faction list — the dropdown duplicates their
information with worse interaction. The invest segment stays: Frostpunk's Book of Laws validates
non-spatial decrees as dedicated buttons with visible costs.

## Behavior

- **Chip click = select peace** (never execute — the advisor's semantic): clicking a
  `.neighbor-chip` sets `pendingAction = { type: "peace", polity: id }` and calls
  `renderPending()` — the existing blue `.preview-peace` map wash paints that realm, the advance
  button states the turn. Clicking the SAME chip again clears the pending action (toggle);
  clicking another chip retargets. Chips beyond the `+N` overflow are reachable via… nothing —
  overflow neighbors lose dropdown access, accepted: they are by construction the LOWEST border
  pressure (sorted desc, ≤2 edges typically) and still reachable next turn as fronts shift; noted
  as a conscious trade.
- **Truced (🤝) chips stay clickable** — re-proposing peace renews the truce, exactly what the
  dropdown allows today.
- **The `— 🕊 강화 요청 —` dropdown is REMOVED.** The command bar shrinks to
  `[💰 전국][💰 국경] [관망] [진행 ▶]`.
- **Advance label names the counterparty**: the peace branch of `summary()` becomes
  ` — 🕊 {polity name}` (was the generic `advPeace` "🕊 강화") — with the dropdown gone, the
  button is where the selection is confirmed, so it must say WHO.
- **Affordance**: chips get `cursor: pointer`, a hover ring, and a `.selected` outline while they
  are the pending peace target. The how-to card's action line (`howto2`) is rewritten to teach
  all three input surfaces: map click (attack/build), neighbor chip (peace), invest buttons.

## Implementation surface

- `src/ui/playApp.ts`: chip click handler in the `renderPanel` chips loop (chips need `data-id`);
  `renderActions` loses the `pce` select block; `summary()` peace branch uses the polity name.
- `src/ui/i18n.ts`: rewrite `howto2` (both langs); DELETE now-dead keys after grepping for zero
  callers: `peacePlaceholder`, `tipPeace`, `advPeace` (the tip's content folds into `howto2`'s
  new text: "화친은 30년 불가침, 내가 공격하면 파기").
- `src/theme.css`: `.neighbor-chip { cursor: pointer }`, hover ring, `.neighbor-chip.selected`.
- Engine untouched.

## Non-goals

Moving invest anywhere (Frostpunk-validated as-is); a diplomacy screen; chip actions beyond peace
(no attack-via-chip — attacks are spatial, the map owns them); keyboard access to chips.

## Testing

1. Chip click → `pendingAction` peace: advance label contains 🕊 AND the polity name; map has
   `.preview-peace`; second click clears both.
2. `.peace-select` no longer exists; retarget every test that used it (the F3 attitude-icon
   option test and the F4 flip-to-friendly test become chip-driven).
3. Peace still works end-to-end: chip click + advance → that chip renders 🤝 next turn.
4. Truced chip click re-selects (renewal allowed).
5. i18n: deleted keys have zero callers (grep); howto2 updated in both langs.

## Sources

- [Empire: Total War — Diplomacy Explained (click the faction)](https://etw.heavengames.com/articles/strategy/campaign/diplomacy-explained/)
- [eXplorminate — Polytopia (contextual minimal UI)](https://explorminate.org/mobile-experience-the-battle-for-polytopia/)
- [Game Design Thinking — Frostpunk Book of Laws](https://gamedesignthinking.com/frostpunk-players-decisions/)
