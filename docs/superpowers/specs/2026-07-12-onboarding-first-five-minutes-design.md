# Onboarding: the First Five Minutes — Design

**Date:** 2026-07-12 · **Scope:** landing + Version B picker/first turns + one Version A touchpoint (language init). **Origin:** self-feedback pass (evidence gathered live at localhost): language resets to EN every visit, nations are chosen blind without a map, the goals line is icon soup ("✗ 0/3"), the how-to is a 4-paragraph wall competing with a turn-0 dilemma card, and the daily button doesn't say why it exists.

**Explicitly out of scope:** the mobile/touch pass (own session), sound/animation juice, chronicle i18n scope-outs.

## 1. Language auto-detect + persistence

**Problem:** both apps hard-code `let lang: Lang = "en"` (app.ts:43, playApp.ts:34); a Korean player clicks 한국어 every single visit. Nothing persists.

**Design:** new pure module `src/ui/lang.ts`:

- `detectLang(navLang?: string, storage?: StorageLike): Lang` — order: (1) `storage.getItem("wm:lang")` if exactly `"ko"` or `"en"`; (2) `navLang ?? navigator.language` starts with `"ko"` → `"ko"`; (3) `"en"`. All storage access try/catch (privacy mode ⇒ silent fallback), same `StorageLike` pattern as `legacy.ts`.
- `saveLang(lang: Lang, storage?: StorageLike): void` — try/catch `setItem("wm:lang", lang)`.

Both `app.ts` (Version A) and `playApp.ts` initialize `lang = detectLang()` and call `saveLang(lang)` inside their existing toggle handlers. The landing page stays bilingual-inline (both languages printed) — no toggle there, no change.

## 2. Nation picker minimap (hover highlight)

**Problem:** the picker is a text list ("Khogrkraar · 398 cells · easy"); you can't see whether your nation is an island, wedged against the hegemon, or coastal. A map game opens with a non-map choice.

**Design:** the picker already computes `initPlaySim(world, seed, 0, "internal")` for `agg0` and throws the state away. Keep `owner0 = s.owner` (same IIFE, return both). Render a minimap in the picker:

- Build once per paint: `renderWorld(world, "political", [], lang)` with its `.political-slot` filled by `politicalLayer(world.grid, owner0, world.polities, { fills: true, labels: false, legend: false, playerPolity: hoveredId, playerColor: PLAYER_COLOR })` where `hoveredId` is `-1` (no highlight) by default.
- Card `mouseenter`/`focus` → repaint the minimap slot with `playerPolity: p.id` (the hovered nation renders in the player magenta — zero new renderer code, the option already exists); `mouseleave`/`blur` → repaint with `-1`. Repaint replaces only the political-slot children (cheap; the world SVG is built once and kept).
- Selection stays on card click — the map is read-only (no click handlers; `pointer-events: none` on the minimap container is acceptable).
- Layout: wide screens two columns (nation list left, sticky minimap right); narrow screens minimap above the list. Container class `.picker-map`, sized by CSS (`max-width` ~380px, svg scales via viewBox).
- The legacy panel and daily badge render as today, below/above unchanged.

**Note:** `politicalLayer(..., playerPolity: -1)` must behave as "no highlight" — verify; if it requires a valid id, use option-omission (`playerPolity: undefined`) for the neutral paint instead.

## 3. Goals line legibility

**Problem:** `목표: ⚔ 라이벌 7 · 🏘 0/6 ✗ 0/3 · 👑 0/500` — the ✗ is the prosperity cohesion gate and 0/3 the streak, which even the author can't sight-read.

**Design:** `renderGoals()` (playApp.ts:602) emits three labeled chips instead of one string. Each chip = `<span class="goal-chip" title="...">`:

- ⚔ `goalConquest`: KO `정복 — 라이벌 {n}국` / EN `Conquest — {n} rivals left`; tooltip `tipGoalConquest`: KO `모든 라이벌 국가를 무너뜨리면 정복 승리` / EN `Defeat every rival realm for a conquest victory.`
- 🏘 `goalProsper`: KO `번영 — 도시 {c}/6 · 결속 {ok} · 연속 {s}/3` / EN `Prosperity — cities {c}/6 · cohesion {ok} · streak {s}/3` where `{ok}` is ✓/✗; tooltip `tipGoalProsper`: KO `도시 6개를 보유하고 결속을 유지한 채 3턴 연속 버티면 번영 승리` / EN `Hold 6 cities with healthy cohesion for 3 consecutive turns.`
- 👑 `goalEndure`: KO `존속 — {y}/500년` / EN `Endure — year {y}/500`; tooltip `tipGoalEndure`: KO `500년까지 수도를 지키면 존속 승리` / EN `Keep your capital until year 500.`

The pending-foundCity hint (`fxCityNext`) stays, appended as a fourth chip when active. All keys in BOTH `PLAY_UI.en` and `PLAY_UI.ko`.

## 4. How-to stepper card

**Problem:** first open shows all of howto1–4 (322 chars KO) at once, beside a turn-0 dilemma card — two competing "read me" boxes.

**Design:** `renderHowto()` gains two modes, tracked by `startGame`-scoped state `howtoMode: "steps" | "full"` and `howtoStep: number` (0-based):

- **First open (`"steps"`, the initial state):** the card shows the title + ONLY `howto{step+1}` + one button: `howtoNext` KO `다음 ({i}/4)` / EN `Next ({i}/4)` for steps 0–2, and the existing `howtoStart` (▶ 통치 시작) on step 3. Next increments `howtoStep` and re-renders; Start sets `showHelp = false` as today.
- **Reopen via the existing "?" button:** sets `howtoMode = "full"` — the card renders all four lines + Start, exactly today's layout (reference mode).
- No sim, dilemma, or rng interaction — pure rendering. The turn-0 dilemma card renders beside it as today (the stepper is small enough that the combined load is acceptable; hiding the dilemma was rejected because an unseen card silently expiring on advance is worse, and the expiry lives inside the verbatim advance handler).

## 6. Daily framing copy

**Problem:** the daily button is a date with no promise; clicking it looks identical to any seed.

**Design:**
- Landing: one sub-line under the button, inside `.landing-daily`: `<p class="landing-daily-sub">매일 자정(UTC) 새로운 세계 — 모두가 오늘 같은 세계에 도전합니다 · One shared world each day</p>` (bilingual-inline like the rest of the landing).
- Picker: the existing `.daily-badge` gains `title = playT(lang, "dailyTip")`: KO `오늘 하루 모두에게 같은 세계 — 이 세계의 연대기가 오늘의 명예의 전당입니다` / EN `Everyone shares this world today — its annals are today's hall of fame.`

## Testing

- `src/ui/lang.test.ts`: storage value wins; ko-KR / ko / en-US / undefined navLang paths; corrupt storage value ("de") falls through to detection; saveLang round-trip; storage throwing never throws out.
- `playApp.test.ts`: picker renders `.picker-map` with a filled political slot; dispatching `mouseenter` on a nation card repaints with that polity in `PLAYER_COLOR` (assert some path fill equals the magenta), `mouseleave` clears it; goals area contains three `.goal-chip` spans each with non-empty `title`; first-open howto shows exactly one `.howto-line` and a Next button, clicking Next 3× reaches Start, "?" reopen shows four `.howto-line`s; daily badge has non-empty title (extend the existing badge test).
- `landing.test.ts`: `.landing-daily-sub` present.
- `app.test.ts` or `lang.test.ts` covers Version A init indirectly (detectLang unit-tested; app.ts wiring is one line — verified by tsc + existing app tests still passing with jsdom's default `navigator.language` of en-US, which keeps every existing EN-asserting test green).
- Determinism: all changes are UI-layer; golden hashes and the verbatim advance handler untouched. jsdom `navigator.language` is "en-US" so EXISTING tests keep their EN default behavior with zero fixture edits — this is a hard requirement; if any test environment reports otherwise, pin via the injectable `navLang` parameter, not by mutating globals.

## Rejected alternatives

- **Map-click nation selection** — mis-click risk, extra handlers/tests; hover highlight delivers the "where am I" value alone.
- **Turn-linked coach marks (first 3 turns)** — duplicates the existing advisor line's role and competes with the turn-0 dilemma; the stepper reuses existing copy with zero sim coupling.
- **Hiding the turn-0 dilemma while the how-to is open** — a hidden card still expires on advance (expiry logic is inside the verbatim advance handler and can't be amended); an invisible expiring card is worse than a busy first screen.
- **Landing language toggle** — the landing is deliberately bilingual-inline; a toggle adds state for no reading-cost win.
- **Browser `Accept-Language` server negotiation** — static Pages hosting; client-side detection is the only option anyway.
