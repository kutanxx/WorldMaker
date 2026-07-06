# Play-mode legibility bundle — Version B sub-project ② (feel follow-up)

Status: approved design (2026-07-06). Makes the empire sim *readable in the moment* without changing
any balance. Grounded in a live playthrough that surfaced two feel gaps: **(a) big swings (a civil
war shed 265→151 cells) were invisible in the panel**, and **(b) the single-cell attack feels
marginal against the sim's ±100-cell swings.** This bundle fixes (a) fully and improves the legibility
of (b); it does NOT change (b)'s mechanics (that is a separate, later mechanics tweak — noted, not
built here).

Benchmarks borrowed: **Risk / EU4** (front legible on the map), **Plague Inc. / Football Manager**
(a per-turn summary + emphasized headlines), **Reigns** (a one-line cause of death).

## Hard constraint

**UI-only. No engine behavior change, no determinism impact.** Everything reads existing state
(`s.owner`, `borderTargets`, `frontEdges`, `r.events`) and renders. The pure-history golden hashes stay
byte-identical. The one engine ADDITION is a pure, side-effect-free enumerator (`frontEdges`) plus
exporting an existing constant (`CONTEST_THRESH`) — neither is called on the pure path.

## Three parts

### 1. Front-line overlay on the map (Risk)

A new `frontEdges(s): FrontEdge[]` enumerator (in `intervention.ts`, beside `borderTargets`) returns
one entry per player-vs-enemy **land** border edge, classified:

- **`"threat"`** — the enemy could take the player's cell here: mirrors the sim's own contest rule,
  `contestStrength(enemy, myCell, enemyCell) > contestStrength(player, myCell, myCell) × CONTEST_THRESH`.
- **`"push"`** — otherwise, if the player could take the enemy cell here (same rule the dropdown uses,
  `contestStrength(player, enemyCell, myCell) × ATTACK_EDGE ≥ contestStrength(enemy, enemyCell, enemyCell)`).
- neither ⇒ omitted (neutral edges are not drawn).

`FrontEdge = { cell: number; enemy: number; kind: "push" | "threat" }` (cell = player-owned, enemy =
adjacent enemy-owned). Threat takes priority when an edge qualifies as both (danger is the more
important cue). Requires exporting `CONTEST_THRESH` from `historySim.ts` (used by the sim's contest;
now also by the threat test). Unclaimed (`owner < 0`) and ocean neighbours are skipped.

Renderer (`playApp.renderMap`): a `<g class="front">` between the political layer and the markers.
For each `FrontEdge`, draw the shared edge (`sharedEdge(grid.polygons[cell], grid.polygons[enemy])`,
reused from `borders.ts`) as a thick stroke — **green (`#3f9e57`) for push, red (`#c0473f`) for
threat**. Rationale for edges over filled cells (self-review): filling 40–50 tiny Voronoi cells reads
as noise; a colored **frontier line** reads as a front and keeps the political colors visible.

Sea (amphibious) opportunities: for each `borderTargets` entry with `sea && capturable`, draw a small
green **⛵** marker at the enemy cell centroid (few of these, no noise). Sea threats are out of scope
(amphibious attacks on the player are rare; YAGNI).

### 2. Decade summary + player headlines (Plague Inc. / FM)

On `Advance`, before stepping, snapshot the player's owned cells; after the turn, diff against
`s.owner`:

- **Delta headline** appended to the log each decade: `Year 180: +8 −114 cells` (gained / lost split,
  from the owner diff — a single net number would hide that a civil war *lost* 114 while border
  contests *gained* 8). Omit a side when zero (`+8 cells` / `−114 cells`). This is the reliable signal
  that catches erosion even when no discrete event fires.
- **Emphasized headlines**: `r.events` whose `polityId === playerPolity` or `otherId === playerPolity`
  render as `.chronicle-event.headline` (bold + an icon) instead of a plain row: civil war of the
  player (⚔, `type civilwar`, `polityId`), secession from the player (🏴, `independence`, `otherId`),
  the player conquering a nation (👑, `conquer`, `polityId`), the player's golden age (☀, `goldenage`).
  Non-player events stay plain rows. (Event `.text` is the engine's Korean history string; in EN mode
  it stays Korean — the pre-existing, accepted mixed-language scope-out. The delta line and defeat
  cause, which we generate, ARE localized.)

### 3. Cause of defeat (Reigns)

In `end(defeated)`, when defeated, find this turn's conquer event
(`type === "conquer" && otherId === playerPolity`) — it is always present, since defeat coincides
exactly with the seat cell being captured (locked by the existing invariant test) — and append the
conqueror's name to the banner: **“Conquered by {name}.”** / KO **“{name}에게 정복당함.”** Survival
(year 500) shows no cause line.

## i18n

New generated strings via the established `PLAY_UI` / `playLog` pattern (KO + EN):
- `playDelta(lang, year, gained, lost)` → `Year 180: +8 −114 cells` / `180년: +8 −114 셀`.
- `playDefeatCause(lang, name)` → `Conquered by {name}.` / `{name}에게 정복당함.`
Headline event text is not re-translated (inherits the KO history string, as above).

## New modules / touch list

- `intervention.ts` — add `FrontEdge` type + `frontEdges(s)` enumerator (pure).
- `historySim.ts` — `export const CONTEST_THRESH` (already the sim's contest constant; just expose it).
- `i18n.ts` — `playDelta`, `playDefeatCause`.
- `playApp.ts` — front `<g>` in `renderMap`; owner-diff delta + headline styling in the advance
  handler; defeat cause in `end`; keep the accumulated-log/rerender behavior.
- `theme.css` — `.front` stroke widths + `.chronicle-event.headline` (bold + colour) if needed.

## Testing (TDD)

- `intervention.test.ts` — `frontEdges`: an overwhelming player yields `push` edges pointing at
  capturable enemy cells and no `threat`; a defenceless player yields `threat` edges on its own border
  cells; ocean/unclaimed neighbours excluded; threat wins when both apply.
- `historySim.test.ts` — `CONTEST_THRESH` is exported and > 1.
- `playApp.test.ts` (jsdom) — after selecting a nation the map has a `.front` group; advancing appends
  a delta line matching `/[+−]\d+/`; a forced player-involved event renders with `.headline`; a forced
  defeat banner contains the conqueror’s name (EN) and, toggled, the KO cause.
- Golden `history.test.ts` / `historySim.test.ts` determinism — unchanged (UI-only; `frontEdges` and
  the exported constant are never invoked on the pure path).

## Out of scope (YAGNI / later)

Click-to-attack on the map (needs Voronoi hit-testing — the dropdown stays the action path; the
overlay is informational only, an acknowledged read/act disconnect); animated transitions; sea
*threat* markers; making the single-cell attack mechanically weightier (gap (b) — a later mechanics
pass, e.g. capturing a small cluster or a follow-on cohesion effect); re-translating Korean history
event text for EN mode.
