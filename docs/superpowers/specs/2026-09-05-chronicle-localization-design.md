# Chronicle localization — tell the history in the reader's language

**Date:** 2026-09-05
**Status:** design, approved (approach A)

## The defect

The gazetteer already follows the UI language, and its *mined* chronicle — the moments derived
from the snapshots — is bilingual. The events the simulation *recorded* are not. `historySim.ts`
builds each one as a finished Korean sentence at seven sites (lines 266, 274, 408, 439, 466, 476,
486) and stores it in `HistoryEvent.text`. Both readers of that field — the on-screen chronicle
panel (`chronicle.ts:28`) and the exported document (`gazetteer.ts:458`) — can only print what
they are given. So an English session produces a document whose recorded history is Korean:

```
0년, Dhaishdhar 건국
30년, Vaealelael이 Khokgraur을 정복
140년, 내란이 Zaiashain을 Komtros·Thaendfoul로 쪼갬
190년, 자유도시 Sah 독립 선포
```

The on-screen panel is worse: its own chrome is hardcoded too — the title `연대기 (0–500년)` and
every century header `0년대` are Korean in both languages.

Seed 1 records 31 events across five centuries. All 31 are Korean today.

## Why this shape

The industry answer is not to translate sentences but to stop building them in the simulation:
keep named slots and assemble the sentence per language at display time. Paradox keeps event text
as localization keys with parameterized commands; the general web standard is ICU MessageFormat.
Every game-localization guide says the same thing — word order does not survive piecewise
translation, so pass values as named placeholders the target language can reorder. Korean particle
selection sits outside those standards, but `korean.ts` already provides that hook.

ICU MessageFormat itself was considered and rejected: seven messages and two languages do not
justify a catalog format and a dependency in a repo whose i18n is a 55-line `Record`.

The English voice is **not** an open question — the repo already settled it. `minedChronicle`
writes `Year 240 — Aeltha reaches its greatest extent, 61 tiles (under Corran II)`, and the
recorded events are interleaved into that same list. Two voices in one document would be a defect,
so the recorded events must adopt it: `Year N — ` followed by a present-tense clause.

## Architecture

### 1. The event becomes data again

`HistoryEvent` loses `text` and gains only what no id can recover:

```ts
export interface HistoryEvent {
  year: number; type: HistoryEventType;
  polityId: number; otherId?: number; cell?: number;
  /** a name the simulation coined that no id can recover:
      the city `newCity` founds, the free port `staple` designates */
  name?: string;
  /** the successor states a civil war split a realm into (ids into `polities`) */
  intoIds?: number[];
}
```

Everything else is already reachable. Which field carries what:

| type | polityId | otherId | name | intoIds |
|---|---|---|---|---|
| `found` | the realm founded | — | — | — |
| `staple` | the owner of the port cell (may be −1) | — | the port's name | — |
| `goldenage` | the realm | — | — | — |
| `newCity` | the founder | — | the city's name | — |
| `conquer` | the conqueror | the conquered | — | — |
| `civilwar` | the realm that split | — | — | the successors |
| `independence` | the new free city | the realm it left | — | — |

`newCity` today interpolates `s.nameGen.place()` straight into the sentence and throws the name
away. Storing that same call's result in `name` **changes no rng draw** — the call stays exactly
where it is, consuming exactly what it consumed. `civilwar` today joins the successor names into
one string; storing ids instead lets the separator be a language's choice (`·` in Korean,
`A and B` in English) rather than a simulation constant.

### 2. One renderer, two readers

New pure module `src/engine/eventText.ts` — DOM-free, rng-free, no side effects:

```ts
export type EventLang = "en" | "ko";
export function eventText(e: HistoryEvent, polities: HistoryPolity[], lang: EventLang): string;
```

A `switch (e.type)` with a Korean branch (today's strings verbatim, via `withJosa`) and an English
branch. The returned string **includes its own year prefix** (`0년, ` / `Year 0 — `), as
`HistoryEvent.text` does today — both readers print the line as-is. Unknown or out-of-range ids fall back to `String(id)`, matching `minedChronicle`'s `nameOf`
— a malformed event prints oddly, it never throws.

It lives in `engine/` because `gazetteer.ts` is an engine module and needs it; `chronicle.ts` (UI)
imports downward, which the layering already allows.

The English sentences, against seed 1's real names:

| type | English |
|---|---|
| `found` | `Year 0 — Dhaishdhar is founded` |
| `staple` | `Year 0 — Forthor is named a free port` |
| `goldenage` | `Year 10 — a golden age dawns in Korvruk` |
| `newCity` | `Year 20 — Vaealelael founds Noun` |
| `conquer` | `Year 30 — Vaealelael conquers Khokgraur` |
| `civilwar` | `Year 140 — civil war splits Zaiashain into Komtros and Thaendfoul` |
| `independence` | `Year 190 — the free city of Sah declares independence` |

Successor lists join as `a and b`, and `a, b and c` for three or more.

### 3. The panel's own chrome

`renderChronicle(history, lang)`. The title and century headers move into `i18n.ts` as two small
functions beside `biomeName`, because both interpolate a number:

- `chronicleTitle(lang, years)` → `연대기 (0–500년)` / `Chronicle (years 0–500)`
- `eraLabel(lang, startYear)` → `100년대` / `100s`

`i18n.ts`'s header comment currently claims the chronicle is out of its scope; that becomes "the
chronicle's chrome, not its content".

No new wiring is needed for the language toggle: it calls `showWorld()`, which already rebuilds the
chronicle from scratch (`app.ts:128`).

### 4. Data flow

```
historySim  →  HistoryEvent{type, ids, name?, intoIds?}
                      │
                      ├──→ chronicle.ts   (lang from the UI toggle)  ──→ eventText → panel row
                      └──→ gazetteer.ts   (lang passed by app.ts)    ──→ eventText → markdown line
```

## What must not move, and how we prove it

`history.test.ts:171` folds `e.text` and `p.name` into two golden hashes. Removing `text` moves
both, and they will be re-pinned deliberately. That is not a licence to move anything else:

- **The snapshot territory hash folds no strings at all.** It must reproduce its pinned value
  untouched. That is the proof the world's history is unchanged.
- **`world.test.ts`'s `polityOf` and `cityCells` hashes must reproduce untouched.** That is the
  proof no rng draw shifted and no city moved.
- **Korean output stays byte-identical.** Seed 1's 31 recorded lines are pinned as a literal
  fixture; a single changed character fails. This task fixes English, it does not rewrite Korean.

## Testing

1. `eventText.test.ts` — all seven types in both languages; particle selection across a name ending
   in a consonant (`Khokgraur을`) and one ending in a vowel (`Kaarkgruau를`); successor joins at two
   and at three.
2. Korean regression lock — the 31-line seed-1 fixture above.
3. `history.test.ts` — golden hashes fold `name` and `intoIds` in place of `text`; events and
   polities hashes re-pinned, territory hash asserted unchanged.
4. `chronicle.test.ts` — with `lang: "en"`, rows, title and century headers are all English.
5. `gazetteer.test.ts` — **the acceptance criterion: an English gazetteer contains zero `[가-힣]`
   characters.**

## Out of scope

- Improving the Korean wording. It stays byte-identical.
- A third language. The shape admits one; nothing is built for it now.
- Redesigning the chronicle panel's look or its century grouping.
- `minedChronicle` — already bilingual, untouched.
