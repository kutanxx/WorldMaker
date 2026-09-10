# Korean names — design

**Status:** approved in chat (scope: transliterate proper nouns AND translate the phrase names;
plus fix A, the repeated region noun). Awaiting spec review.

## The problem, measured

The site is bilingual and the map is not. Measured at 1920x945 on seed 1 with the UI in Korean,
terrain view: **22 labels are visible on the world map and 20 of them are in Latin script.** Ten are
English phrases — `THE BLACK FOREST`, `BARRENS OF DIMBRERK`, `MOOR OF THITHLE`, `the Green Deep` —
and the rest are Latin proper nouns: `Sahias`, `Khaagg`, `Krathgath`. (The five river names are in
the same state; none survived deconfliction at this view.) A Korean reader gets a Korean interface
wrapped around an English map.

Two different problems wear the same complaint:

| | what it is | what it needs |
|---|---|---|
| `the Bitter Jungle`, `Zash Fork` | English **common** nouns and adjectives, baked into a string at generation time | **translation** — "비터 정글" is nonsense; "쓰라린 밀림" is the name |
| `Sahias`, `Khaagg` | invented **proper** nouns | **transliteration** — 사히아스, 카아그 |

A third thing was measured while looking: **75% of worlds repeat a region noun** (20 seeds, 247
regions). `Wilds` is registered in three biome tables at once (taiga, temperate forest, tropical)
and takes 22 of 247 regions, which is how one map ends up showing `the Grey Wilds`, `Wilds of
Brastrial` and `Trianork Wilds` together.

Two things that LOOKED like defects and were not, both caught by counting:

- 64 of 349 realm names match a city name — **all 64 are free cities**, whose realm is named after
  the city by design. Not a defect.
- "mountains have no names" is false: every world of 20 had at least one named alpine region
  (1.4 on average). Ranges are named; individual peaks are not, which is right at this scale.

## Decisions

### 1. The English output must not move. The structure is ADDITIVE.

`Region.name` and `River.name` stay exactly as they are — the English string, still what the
goldens fold, still what the exported JSON carries. A new field carries the *structure* beside it:

```ts
export type FeaturePattern = "adj" | "of" | "attributive";
export interface FeatureLabel {
  pattern: FeaturePattern;
  kind: number;          // biome (regions) or -1 (rivers)
  adj?: string;          // "iron" — a key into the adjective table, not a rendered word
  noun: string;          // "frostlands"
  proper?: string;       // the invented word, when the pattern has one
}
```

`featureLabel(label, "en")` renders the phrase; **a test asserts it reproduces `name` byte for byte
across twenty seeds.** That test is the proof that this change cannot move the English map, the
English gazetteer, or any golden that folds those strings — a far stronger claim than a re-pin.

`featureLabel(label, "ko")` renders the Korean phrase:

| pattern | English | Korean |
|---|---|---|
| `adj` | the Bitter Jungle | 쓰라린 밀림 |
| `of` | Barrens of Dimbrerk | 딤브레르크의 황무지 |
| `attributive` | Trianork Wilds | 트리아노르크 야생지 |

69 words need Korean: 20 adjectives, 37 region nouns, 7 river nouns, 5 world nouns. A closed list.

### 2. Transliteration is a closed table, not a guess

Generated names are assembled from token tables, and **the repairs in `names.ts` only ever delete
characters or join two tokens — none of them introduces a letter no token contains.** So the token
tables ARE the inventory, exactly:

- 46 onsets: `ae br c cor d dh dr el f fj g gg gl gr gru h hr k kh kr l li ly m mel n r s sa sh sha si sk st sv sy t th thr tr v va val vr z za`
- 15 vowels: `a aa ae ai au e ea ei i ia io o ou u y`
- 25 codas: `an ar el fr gg gr h is k kh l m n nd or r rk rn s sh th um us vik z`
- **22 letters**: `a b c d e f g h i j k l m n o r s t u v y z` — no p, q, w, x.

`toHangul(word)` is a greedy longest-match over an ordered rule table (digraphs before letters),
assembling Hangul syllables the way Korean writes foreign proper nouns. Pure, deterministic, no rng.
Guarded by: every proper noun over twenty seeds transliterates to Hangul with **no Latin left**, and
the same input always gives the same output.

### 3. It is a DISPLAY concern, in Korean mode only

Nothing in `src/engine/` stores a Korean name. The world data is one world with one set of names;
Korean is a way of writing them. This keeps a shared-seed link meaning the same world in both
languages — a Korean reader and an English reader can talk about the same city.

Applies at: world map labels (city, realm, region, river), the city list, the city plate, the
chronicle panel, the Korean gazetteer, and the world title.

### 4. Josa gets MORE accurate, not less

`korean.ts` already reads a Hangul syllable's final consonant exactly (`(code - 0xac00) % 28`) and
falls back to *guessing from the Latin letter* for Latin names. Feeding it Hangul removes the guess.
Some particles will therefore change — `Kaargruth이` is decided by the letter `h` today and by the
syllable `스` tomorrow — and that is a correction, not a regression.

### 5. Fix A: the repeated region noun

`Wilds` is in three biome tables. The fix is at selection rather than in the tables: when naming a
world's regions, prefer a noun this world has not used yet. `pick` is `arr[Math.floor(rng() * arr.length)]` — one
draw whatever the array holds — so **the draw count does not move and neither does any geometry**
(verified in `rng.ts`, not assumed). The English strings DO change, so this is its own commit with
its own English re-pin.

## What must not move, and what may

| | may move | proof it did not |
|---|---|---|
| `allSnap`, world goldens (`polityOf`, `cityCells`) | **never** | they are asserted before everything else |
| English map, English gazetteer | **never** (items 1-4) | `featureLabel(label,"en") === name` over 20 seeds |
| English gazetteer | only in item 5 | re-pinned, with the reason recorded |
| Korean gazetteer + chronicle hashes | yes | re-pinned; line COUNTS must hold |

## Staging

1. `FeatureLabel` + `featureLabel()` + the English-identity test. No visible change.
2. `toHangul()` + its tests. No visible change.
3. Korean wiring at the five display sites + Korean re-pin. **This is where the map changes.**
4. Fix A + English re-pin.

## Open questions for review

1. **Region labels are uppercased** (`r.name.toUpperCase()` for land). `toUpperCase()` does nothing
   to Hangul, so the Korean map loses that distinction. Proposal: keep the existing size and
   letter-spacing, drop the uppercase step for Korean rather than inventing a new device.
2. **The world's own name** (`Sodend`) — transliterate too (소덴드), for consistency. Confirm.
3. **Free, if wanted:** the Korean realm label could read `케우스두 왕국 / 공화국 / 제국` by reusing
   `classifyGovernments` from 2026-09-10, and a people could read `드루스브라우인`. Both are display
   suffixes: **no generated name changes and nothing already deployed moves.** They answer two of
   the naming complaints (a realm reads like a town; a people reads like a place) without touching
   the generator. Say whether to include them.
