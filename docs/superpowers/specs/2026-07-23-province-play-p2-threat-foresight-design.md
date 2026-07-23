# Province play P2: threat foresight (design)

Date: 2026-07-23
Scope: `playProvince.html` (province game), play mode.

P2 of the playtest-driven improvement set (P1 shipped). This is the "know what is
happening and why" group: the game already forewarns defection but says nothing about
incoming enemy attacks, names no culprit when you lose land, and gives no readable
capital-threat signal — the only losing condition. P2 makes losses predictable and
attributable.

## Problems (from two playtests)

1. **Incoming enemy attacks have no warning.** Defection shows "⚠ defects in 3", but a
   province conquered by an enemy next turn is unannounced — a controller playtest lost 3
   provinces in one turn with zero prior signal.
2. **Losing your capital is unannounced** — the sole defeat condition. The HUD's "capital
   held" flips only *after* it falls, when the game is already over.
3. **A loss names no attacker.** The log says `lost X` with no "to whom", so across 7
   rivals the player cannot tell who is eating them.
4. **Consolidating shows no result.** Shoring up an at-risk province leaves its warning
   text unchanged, so the player cannot see that their action did anything.
5. **The defection tooltip does not explain the paradox** the user hit: a 70%-solidarity
   province defects while a 53% one holds — because defection is neighbour-count-driven,
   not solidarity-driven, and the tooltip does not say so.
6. **The chronicle log is one unbroken line** of `·`-joined entries, so this turn's events
   are indistinguishable from history.
7. **The ⚓ expedition reason contradicts itself:** an attack reads "your realm is strong"
   yet "fails", because the reason decomposition ignores the sea-expedition penalty that
   actually sank the attack.

## Architecture

Two golden-safe engine additions in `src/engine/provinceSim.ts` (pure predictors, never on
the golden simulation path), plus UI in `provinceApp.ts` + `theme.css`. The four goldens
(init `226648593`, 50-tick `2503300448`, player path `2374466985`, Version A `1350115163`)
must be proven unchanged by a test.

### Engine addition 1 — `forecastIncoming`

```
export interface IncomingThreat { prov: number; attacker: number }
export function forecastIncoming(
  s: ProvinceSimState, playerId: number,
  opts?: { consolidate?: boolean; targets?: ReadonlySet<number> },
): IncomingThreat[]
```

Pure and read-only: it must not mutate `s`. It mirrors the first half of `stepPlayerTurn`
on a shallow clone (own `provSol`/`provOwner`/`unrest` buffers):

1. Apply the same solidarity step the real turn applies (`computeSteppedSol`).
2. If `opts.consolidate`, add `CONSOLIDATE_BONUS` to each `targets` province the player
   owns — exactly as `stepPlayerTurn` does — so a consolidate selection changes the
   forecast.
3. Run the AI attacker contest (`aiAttacker(s, playerId)`) against the player's OWN
   provinces only, using the same `strength` / `CONTEST_THRESH` / `EXPEDITION_MULT` math,
   and return `{ prov, attacker }` for each player province that would flip to an enemy.

**Why this is faithful and why it needs only `consolidate`/`targets`:** in the real
`stepPlayerTurn`, a player-owned province is always contested by `aiAttacker` (the player's
own targets only affect ENEMY provinces), and attack-exhaustion is applied AFTER the
contest, so it affects the NEXT turn, not this one. Therefore this turn's incoming
conquest losses depend only on the solidarity step and the consolidate bonus — not on which
enemy provinces the player attacks. The predictor shares the engine's own functions, so it
cannot drift from what `stepPlayerTurn` actually resolves (the same contract `explainAttack`
already honours for outgoing attacks).

**Scope: conquest only.** Defection losses are already forewarned by the existing risk
panel with a countdown; forecasting them here too would double-report. `forecastIncoming`
covers only the previously-unwarned case — enemy conquest.

### Engine addition 2 — `explainAttack` expedition reason

Add one `AttackReason`: `"expedition"`. When `lane` is true, the sea crossing scales the
attacker's strength by `EXPEDITION_MULT` (0.6) — a strength loss of `atkUnmult × (1 - mult)`
that the current decomposition omits, producing the "realm strong yet fails" contradiction.
Add this as a reason candidate term with magnitude `−atkUnmult × (1 - mult)` (always a
penalty), so when it dominates, the reason becomes `"expedition"`. The win/atk/def math is
unchanged (atk already has `mult` applied), so `predictCapture` and every golden are
unaffected — only the reason string changes. `reasonText` (in `provinceApp.ts`) gets the
`expedition` case: ko "바다 건너 원정이라 군대가 약해짐", en "the sea crossing weakens the
attack".

## UI

### Unified "this-turn threats" section

To keep P1's one-screen win, the existing defection risk panel and the new conquest
forecast merge into ONE threat section rather than two panels. It reuses the existing
`sortRisksByUrgency` ordering, per-row rendering, and `makePingable` map-ping — each row
gains a kind (defection / conquest) and a colour.

- 🏳 **defection** rows (amber): `{name} — defects in {n} · {reason}` (unchanged content).
- ⚔ **conquest** rows (red): `{name} — falls to {attacker}` / `{name} — {attacker}에게 넘어감`.
- Conquest is always "next turn", so it sorts above defection countdowns of 2+; a
  defection due next turn (1) ties and is ordered by province id, as today.
- Each row pings its province (existing `makePingable`).

Map highlight: threatened-by-conquest provinces get a **red pulsing ring** (`.prov-threat-ring`),
visually distinct from the defection risk ring (amber dashed). Because the forecast is
stance-reactive, selecting a province to consolidate drops it from both the list and the
map ring in real time.

### Capital alarm

If `forecastIncoming` (or the defection set) includes `capitalProv[playerId]`, show a
prominent banner ABOVE the threat section: "⚠ 수도가 위협받고 있습니다 — {attacker}" /
"⚠ Your capital is under threat — {attacker}". Kept out of the list because it is the sole
defeat condition and must not be buried.

### Loss attacker in the log

`lost X` → `lost X (to Y)` / `상실 X (Y에게)`, using the conquest event's `to` (the
conqueror's polity id → name). The data already exists in `PlayerStepEvents`.

### Consolidate feedback

The stance-reactive forecast IS the primary feedback (a consolidated province drops from
the threat list). Add one light confirmation: in consolidate mode, a selected province that
was threatened shows "🛡 지켜짐" / "🛡 protected" on its row or fortify overlay. Minimal —
no new panel.

### Defection tooltip accuracy

Reword the defection risk hint to explain the paradox: neighbour count dominates, and
solidarity is worth about two friendly neighbours. Grounded in the code
(`hold = ownNeighbours + 2×solidarity − 0.003×capitalDist`, `press = strongest rival's
adjacent count`): a well-held province can still defect if it is outnumbered on the ground.
ko example: "이탈은 이웃 수로 정해져요 — 고립되면 안정도가 높아도 넘어갑니다 (안정도는 우호
이웃 2곳 값어치)". en: "Defection is decided by neighbours — an isolated province flips even
at high stability (stability is worth ~2 friendly neighbours)".

### Log grouped by turn

Group chronicle entries by the turn they occurred, newest first:
`T{tick}: +{gained} −{lost}` with gains in the success colour and losses in the risk
colour, keeping the existing per-entry `makePingable`. The most recent turn is emphasised.
`LogEntry` gains a `tick` field (set when the entry is pushed); grouping is pure UI.

## Non-goals

- Picker per-nation info (separate, like P1).
- The negative attack-strength display (`�even -5`) — that is P3.
- Any balance change (slot count, defection thresholds, win target) — that is P4.
- Forecasting defection in the new conquest forecast (the risk panel owns defection).

## Files

- `src/engine/provinceSim.ts` (two pure additions: `forecastIncoming`, the `expedition` reason)
- `src/ui/provinceApp.ts`
- `src/theme.css`

## Tests

**Engine:**
1. Golden guard: init `226648593`, 50-tick `2503300448`, player path `2374466985`,
   Version A `1350115163` all unchanged after these additions.
2. `forecastIncoming` does not mutate `s` (compare `provOwner`/`provSol`/`unrest` before
   and after) and returns `{prov, attacker}` for player provinces that would flip.
3. `forecastIncoming` is FAITHFUL: on a fixture where an enemy will take a player province,
   its predicted `{prov, attacker}` matches the actual flip after `stepPlayerTurn` runs
   with the same `opts` (the predictor and the real step agree).
4. `forecastIncoming` reacts to consolidate: a province in the forecast drops out when
   passed in `opts.consolidate` + `opts.targets` (if the bonus is enough to hold it).
5. `explainAttack` returns `reason: "expedition"` for a lane attack where the expedition
   penalty is the dominant factor, and `win`/`atk`/`def` are byte-identical to before the
   change on a non-lane fixture (reason-only change).

**UI:**
6. The threat section renders both a defection row (amber, 🏳) and a conquest row (red, ⚔)
   when both exist, each pingable; capital threat raises the separate banner.
7. A loss log entry reads `상실 X (Y에게)` / `lost X (to Y)` with the conqueror's name.
8. Consolidate-mode: selecting a threatened province marks it protected and drops it from
   the forecast (drive a fixture/seed where a consolidated province is no longer forecast-lost).
9. The log groups entries under `T{tick}` headers, newest first, gains vs losses coloured.
10. `reasonText` has ko + en for `expedition`.

## Verification (live browser)

jsdom cannot judge the red pulse animation, the panel layout after merging, or whether the
capital banner reads as urgent. Confirm in a real browser: the forecast matches what
actually happens on the next advance (arm nothing, read the forecast, advance, confirm the
predicted provinces flipped to the predicted attackers); consolidating a threatened
province removes it from the forecast live; the capital banner fires when the capital is
forecast-lost; the merged threat section still fits P1's one screen. Final look is the
user's call (screenshots are harness-blocked).
