# Play UI: Action/Dilemma Outcome Preview + Turn Guide (benchmarked)

**Date:** 2026-07-10
**Status:** Approved design (user picked ①+④ from a 4-candidate benchmark study; self-critique revisions folded in)

## Why

User: "UI가 직관적이면 좋겠다 — 타 게임에서 호평받은 걸 벤치마킹해서 적용하자." Research surveyed
praised UI patterns; the two selected:

- **① Outcome preview** — Into the Breach's core principle ("see the outcome before committing";
  dev quote: *"sacrifice cool ideas for the sake of clarity every time"*) + Reigns' dilemma dots.
  This also absorbs the deferred "preview-extension" section of
  `2026-07-07-standing-panel-design.md` and the old "dilemma card map-previews" backlog item.
- **④ Turn guide** — Civ's Next Turn button as the anchor that states what will happen / what
  still needs attention, plus a clickable advisor.

Rejected after critique: exact bot-attack telegraphs (rng makes them fake precision — pattern ②
threat-intent postponed as honest "risk highlighting", separate feature), CK3 rich tooltips
(pattern ③, separate session), turn undo (rng closure blocker, same as save/load).

## Design (post self-critique)

### A. Action preview — badges on the standing meters

When a `pendingAction` exists, the 국력/결속 meters each show a small badge with the projected
effect of **the player's own action only** (world response is separate — see labeling):

| action | 국력 badge | 결속 badge | extra |
|---|---|---|---|
| attack | `▲+n셀` from `predictCapture(s, cell).length` | `▼` — new avg = (Σsol + k·CONQUEST_SOL)/(n+k), shown as `▼−x.x%p` | truce break → threat line `위협 ▲` |
| invest | — | `▲+x%p` from existing `investEffect(scope)` | |
| foundCity | — | — | goals-line hint `🏘 n번째 도시` |
| peace | — | — | threat line `위협 ▼ 휴전 +1` |
| none/pass | no badges | no badges | |

**Key value (critique fix #1):** the attack cohesion drop makes the overexpansion penalty visible
for the first time — conquest visibly costs cohesion before you commit.

**Labeling (critique fix #3):** the badge cluster carries a muted label `내 행동 효과` (EN: "your
action"), because the turn's net momentum also includes bot moves; the preview must not read as a
promise about the whole turn.

### B. Dilemma choice preview — effect line under each choice button

Each of the two choice buttons gets a small muted effect line. **Direction glyphs + odds + cheap
counts only — no fake %p precision** (critique fix #4: replicating `nudgePlayerSol` math per-cell
for an exact average is drift-prone overkill; direction is what the player needs).

| card | choice a | choice b |
|---|---|---|
| unrest | `국경 n셀 양도 · 결속 ▲` (n from shared helper) | `성공 50%: 결속 ▲ / 실패: 결속 ▼` (odds from `CRUSH_ODDS`) |
| raiders | `국경 결속 ▲ · 내지 ▼` | `국력 ▲+n셀` (n from shared best-target helper) or `대상 없음` |
| prosperity | `결속 ▲ (전국)` | `결속 ▲▲ (국경)` (FRONTIER_SOL > FEAST_SOL) |
| defector | `+1셀 · 휴전 파기` | `휴전 +1 (10년)` |

**Anti-drift (critique fix #4):** extract the target/selection logic that `resolveDilemma` already
runs into shared read-only helpers used by BOTH resolve and preview:

```ts
// dilemma.ts (play layer only — never runs in Version A, goldens untouched)
export interface ChoicePreview { cells?: number; cohesion?: -2|-1|0|1|2; odds?: number;
                                 truce?: "break"|"gain"; note?: string }
export function previewDilemma(s: SimState, d: Dilemma, choice: "a"|"b"): ChoicePreview;
// shared internals: concedeCells(s): number[]  ·  bestRaidTarget(s): {cell,gain}|null
```

`previewDilemma` is pure read-only and NEVER calls `s.rng()` (gambles report `odds`, not a roll).
Unit tests pin preview↔resolve consistency on the deterministic branches (e.g. unrest-a shed count
== preview cells; raiders-b applies the same cell preview reported).

### C. Turn guide — the advance button states the turn (critique fix #2: net clutter ↓)

- **Remove** the `.action-status` text span (its message moves into the button).
- `.btn-advance` label becomes the turn statement:
  `진행 ▶` (no action) / `진행 ▶ ⚔ 공격 +12셀` / `진행 ▶ 💰 국경 투자` / etc.
- While a dilemma card is unanswered, the advance button shows a subtle warning dot `·❗`
  (title: "답하지 않은 카드는 사라집니다"). **No confirmation dialogs ever** (critique fix #6 —
  dialog-fatigue research; the card already disappears on answer).

### D. Clickable advisor (critique fix #5: one consistent semantic)

The existing `.advice` line gains one small button. **Semantic: always "select, never execute"** —
it sets `pendingAction` (+ the map paints the existing preview) and the user still presses advance:

- `adviceLowSol` → `[실행]` sets `{type:"invest", scope:"nation"}`
- `adviceExpand` → `[실행]` sets `{type:"attack", cell: bestRaidTarget(s).cell}` (same helper)
- `adviceBuild` → `[실행]` sets `{type:"foundCity", cell: best site}` (first/highest-value from
  `foundCityTargets(s)`; deterministic pick documented in code)
- `adviceDefend` → labelled `[태세 전환]` (NOT 실행) — stance is an instant toggle, not a pending
  action; the differing label marks the differing semantic.

If the advised action is impossible this turn (no capturable target / no site), the button is
omitted — advice stays text-only.

## Architecture

- `src/engine/dilemma.ts`: + `previewDilemma`, shared helpers refactored out of `resolveDilemma`
  (behavior-preserving refactor; existing dilemma tests must stay green unmodified).
- `src/engine/intervention.ts`: no changes expected. The attack-cohesion projection is a local
  pure function in `playApp.ts` next to the existing local `investEffect` (same pattern: read-only
  over `SimState`, imports `CONQUEST_SOL` + `predictCapture`).
- `src/ui/playApp.ts`: meter badges in `renderPanel`, effect lines in `renderDilemma`, advance
  button label + dot in `renderActions` (status span removed), advisor button in the advice block.
  The verbatim advance handler is NOT modified.
- CSS: `.fx-badge` (▲ green / ▼ red, small), `.fx-label` (muted "내 행동 효과"), `.choice-fx`
  (muted line in dilemma buttons), `.advise-act` button, `.advance-alert` dot.
- i18n: all new strings in the `playT` KO/EN table (previewOwnFx, fxCells, fxCohesion, fxOdds,
  fxTruceBreak/Gain, fxNoTarget, adviseAct, adviseStance, advanceAlertTip, …).

## Non-goals

Map threat-intent highlighting (②), rich HTML tooltips (③), turn undo, any engine tuning-const
change, any change visible to Version A (engine golden hashes stay byte-identical — everything is
play-layer/UI).

## Testing

1. `previewDilemma` unit tests: per card/choice shape; rng untouched (call count 0); consistency
   with `resolveDilemma` on deterministic branches; `raidersNoTarget` ↔ preview `note`.
2. `playApp` DOM tests: attack pending → both meter badges rendered (▲ cells, ▼ cohesion); invest
   pending → cohesion badge only; advance button text reflects pending action; dilemma card → two
   `.choice-fx` lines; unanswered card → `.advance-alert` present; advisor button sets
   `pendingAction` (map paints) without advancing the turn.
3. Existing tests: `.action-status` removal will break selectors that query it — retarget them to
   the advance-button label (same information, new home).

## Risks / notes

- Preview accuracy for attack cohesion uses the same `CONQUEST_SOL` const as the engine — if the
  engine ever changes capture solidarity rules, the consistency test catches it.
- `bestRaidTarget` extraction must be behavior-identical to the current raiders-b loop (ties,
  ordering) or dilemma outcomes drift for a given rng stream — covered by keeping existing dilemma
  tests unmodified.
- Harness cannot screenshot: DOM/computed-style verification via `preview_eval`; visual look needs
  the user's eyes at localhost:5173/play.html.

## Sources (benchmark research)

- [Game Developer — Into the Breach: "sacrifice cool ideas for clarity"](https://www.gamedeveloper.com/design/-i-into-the-breach-i-dev-on-ui-design-sacrifice-cool-ideas-for-the-sake-of-clarity-every-time-)
- [Into the Breach's UX makes you feel smart (Prototypr)](https://blog.prototypr.io/into-the-breachs-ux-makes-you-feel-smart-a9cb03210757)
- [Slay the Spire — Intent](https://slaythespire.wiki.gg/wiki/Intent) · [Cloudfall — StS UI](https://www.cloudfallstudios.com/blog/2018/2/20/flash-thoughts-slay-the-spires-ui)
- [Tooltips in tooltips (CK3)](https://philip.design/blog/tooltips-in-tooltips/) · [Victoria 3 adopts CK3 tooltips (PCGamesN)](https://www.pcgamesn.com/victoria-3/nested-tooltip-system)
- [UX Planet — confirmation dialogs without irritation (dialog fatigue)](https://uxplanet.org/confirmation-dialogs-how-to-design-dialogues-without-irritation-7b4cf2599956)
