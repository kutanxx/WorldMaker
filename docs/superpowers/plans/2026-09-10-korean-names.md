# Korean Names Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In Korean mode, every name on the map and in the document reads as Korean — invented proper nouns transliterated to Hangul, English phrase names translated — without the English output moving a byte.

**Architecture:** Names stay exactly as generated: one world, one set of names, Latin in the data. Two display-time layers are added. (1) `FeatureLabel`, a structure carried BESIDE the existing English `name` on regions, rivers and the world, rendered per language by `featureLabel()` — with a test that rendering it in English reproduces `name` byte for byte, which is what makes the English path unmovable. (2) `toHangul()`, a pure transliterator over the closed token inventory the name generator draws from. Korean display sites call both; English sites are untouched.

**Tech Stack:** TypeScript, Vite MPA, vitest. `src/engine/` is DOM-free; `src/ui/` renders. `npm test`, `npm run build` (`tsc --noEmit && vite build`, **noUnusedLocals is on — an unused import breaks CI**).

**Spec:** `docs/superpowers/specs/2026-09-10-korean-names-design.md`

## Global Constraints

- **Determinism:** no task may change how many values come off any rng. `pick(rng, arr)` is `arr[Math.floor(rng() * arr.length)]` — one draw whatever the array holds — so editing a word TABLE is safe, but adding or removing a `pick`/`rng()` call is not.
- **`allSnap` and the world goldens must never move.** `src/engine/history.test.ts` asserts `allSnap` before `events`/`polities`; `src/engine/world.test.ts` pins `polityOf=1026682088`, `cityCells=2824879792`, `provinceOf=2545381283`, 28 cities. If any of those move, the change touched the engine — revert, do not re-pin.
- **English output must not move in Tasks 1-3 and 5.** Only Task 4 (region nouns) may move English, and it re-pins with the reason recorded.
- **Korean re-pins are expected** in Task 3 and Task 5: `src/engine/gazetteer.test.ts` (the `ko` FNV) and any Korean literal in `src/ui/chronicle.test.ts`. **Line COUNTS must hold** (123/130/105) — a moved count means something was added or dropped, not translated.
- **Engine stays DOM-free.** `toHangul` and `featureLabel` live in `src/engine/`; `src/ui/` may import them, never the reverse.
- The engine declares its own `"en" | "ko"` union rather than importing the UI's `Lang` — follow the existing `GazetteerLang` convention in `src/engine/gazetteer.ts`.
- Commit after every task. Run `npx vitest run` (the full suite) before each commit, not just the file under test.

---

### Task 1: `FeatureLabel` — the structure beside the string

**Files:**
- Create: `src/engine/featureLabel.ts`
- Test: `src/engine/featureLabel.test.ts`
- Modify: `src/types/world.ts:41-57` (`Region`, `River`)
- Modify: `src/engine/geography.ts:92-109` (`featureName`, `nameGeography`, `worldName`)
- Modify: `src/engine/rivers.ts:149-167` (`riverName`, `nameRivers`)
- Modify: `src/engine/world.ts` (carry the world's own label beside `name`)

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export type FeaturePattern = "adj" | "of" | "attributive";
  export interface FeatureLabel {
    pattern: FeaturePattern;
    kind: number;        // biome constant for a region; -1 for a river or the world
    adj?: string;        // an ADJ entry verbatim, e.g. "Iron" — a KEY, not a rendering
    noun: string;        // a NOUNS / RIVER_NOUNS / WORLD_NOUN entry verbatim, e.g. "Frostlands"
    proper?: string;     // the invented word, e.g. "Dimbrerk"
  }
  export function featureLabel(label: FeatureLabel, lang: "en" | "ko"): string;
  ```
  and the fields `Region.label`, `River.label`, `World.nameLabel`, all `FeatureLabel`.

- [ ] **Step 1: Write the failing test**

Create `src/engine/featureLabel.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { featureLabel } from "./featureLabel";
import { generateWorld } from "./world";
import { DEFAULT_PARAMS } from "../types/world";
import { ALPINE } from "./biome";

describe("featureLabel", () => {
  it("renders the three patterns in English exactly as the generator wrote them", () => {
    expect(featureLabel({ pattern: "adj", kind: ALPINE, adj: "Iron", noun: "Spires" }, "en"))
      .toBe("the Iron Spires");
    expect(featureLabel({ pattern: "of", kind: ALPINE, noun: "Barrens", proper: "Dimbrerk" }, "en"))
      .toBe("Barrens of Dimbrerk");
    expect(featureLabel({ pattern: "attributive", kind: ALPINE, noun: "Wilds", proper: "Trianork" }, "en"))
      .toBe("Trianork Wilds");
  });

  // THE test of this task. The structure is not a second opinion about the name, it IS the name:
  // if this passes on every seed, no English string on the map or in the gazetteer can move.
  it("reproduces every generated English name, byte for byte, across twenty seeds", () => {
    let checked = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const { world } = generateWorld({ ...DEFAULT_PARAMS, seed });
      for (const r of world.regions) {
        expect(featureLabel(r.label, "en"), `seed ${seed} region`).toBe(r.name);
        checked++;
      }
      for (const r of world.rivers) {
        expect(featureLabel(r.label, "en"), `seed ${seed} river`).toBe(r.name);
        checked++;
      }
      expect(featureLabel(world.nameLabel, "en"), `seed ${seed} world`).toBe(world.name);
      checked++;
    }
    expect(checked).toBeGreaterThan(300);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/engine/featureLabel.test.ts`
Expected: FAIL — `Failed to load url ./featureLabel`.

- [ ] **Step 3: Create `src/engine/featureLabel.ts`, English only**

```ts
// A place name is a STRUCTURE, not a sentence. It used to be assembled into an English string at
// generation time — "the Bitter Jungle" — which bakes a decision about language into the world
// data, and it is why a Korean reader got an English map. The parts are kept instead and the
// sentence is built where it is read: the same lesson the chronicle learned on 2026-09-05.
export type FeaturePattern = "adj" | "of" | "attributive";

export interface FeatureLabel {
  pattern: FeaturePattern;
  kind: number;
  adj?: string;
  noun: string;
  proper?: string;
}

export function featureLabel(label: FeatureLabel, lang: "en" | "ko"): string {
  if (lang === "en") {
    if (label.pattern === "adj") return `the ${label.adj} ${label.noun}`;
    if (label.pattern === "of") return `${label.noun} of ${label.proper}`;
    return `${label.proper} ${label.noun}`;
  }
  return featureLabel(label, "en");   // Korean arrives in Task 3
}
```

- [ ] **Step 4: Run the test — the pattern case passes, the twenty-seed case still fails**

Run: `npx vitest run src/engine/featureLabel.test.ts`
Expected: the first test PASSES; the second FAILS reading `label` of undefined.

- [ ] **Step 5: Emit the structure from the generators**

In `src/types/world.ts`, import `FeatureLabel` and add `label: FeatureLabel;` to `Region` (line 41) and to `River` (line 52), and `nameLabel: FeatureLabel;` to the world type beside `name`.

In `src/engine/geography.ts`, replace `featureName`:

```ts
export function featureName(rng: Rng, ng: { nation(): string }, kind: number): { name: string; label: FeatureLabel } {
  const noun = pick(rng, NOUNS[kind] ?? ["Land"]);
  const r = rng();
  // ⚠ The branches must draw in the SAME ORDER as the if-chain they replace — noun, then r, then
  // either an adjective or a nation — or every world downstream of this call moves.
  const label: FeatureLabel = r < 0.45
    ? { pattern: "adj", kind, adj: pick(rng, ADJ), noun }
    : r < 0.75
      ? { pattern: "of", kind, noun, proper: ng.nation() }
      : { pattern: "attributive", kind, noun, proper: ng.nation() };
  return { name: featureLabel(label, "en"), label };
}

export function nameGeography(rng: Rng, raws: RawRegion[]): Region[] {
  const ng = makeNameGen(rng);
  return raws.map((r) => {
    const { name, label } = featureName(rng, ng, r.kind);
    return { name, label, kind: r.kind, centroid: r.centroid, cells: r.cells };
  });
}

export function worldName(rng: Rng): { name: string; label: FeatureLabel } {
  const ng = makeNameGen(rng);
  const label: FeatureLabel = rng() < 0.5
    ? { pattern: "attributive", kind: -1, noun: "", proper: ng.nation() }
    : { pattern: "adj", kind: -1, adj: pick(rng, ADJ), noun: pick(rng, WORLD_NOUN) };
  return { name: featureLabel(label, "en"), label };
}
```

⚠ `worldName`'s first branch is a bare name with no noun — `featureLabel` must render `{noun: ""}` in the attributive pattern as the proper noun alone, with no trailing space. Add that case to the English renderer and to the Step 1 test:

```ts
expect(featureLabel({ pattern: "attributive", kind: -1, noun: "", proper: "Sodend" }, "en")).toBe("Sodend");
```

In `src/engine/rivers.ts`, `riverName` returns `{ name, label }` the same way over `RIVER_NOUNS` with `kind: -1`, and `nameRivers` spreads `label` onto each river. Update `src/engine/world.ts` where `worldName(...)` is called to take `.name` and `.label`.

- [ ] **Step 6: Run the full suite**

Run: `npx vitest run`
Expected: ALL PASS — including `world.test.ts` (`polityOf`, `cityCells`) and `history.test.ts` (`allSnap`), which cannot move because no draw moved. **If a golden moved, the branch order changed. Fix the order; do not re-pin.**

- [ ] **Step 7: Commit**

```bash
git add src/engine/featureLabel.ts src/engine/featureLabel.test.ts src/engine/geography.ts src/engine/rivers.ts src/engine/world.ts src/types/world.ts
git commit -m "feat(names): carry a place name's parts beside its English string"
```

---

### Task 2: `toHangul` — transliteration over a closed inventory

**Files:**
- Create: `src/engine/hangul.ts`
- Test: `src/engine/hangul.test.ts`

**Interfaces:**
- Consumes: nothing (the test imports `generateWorld`, `simulateHistory`, `buildDynasties`, and `endsWithConsonant` from `./korean`).
- Produces: `export function toHangul(word: string): string` — pure, deterministic, no rng.

**Why a table and not a guess:** every generated name is assembled from the token tables in `names.ts` and `culture.ts`, and the repairs (`weld`, `deStutter`, `collapseRuns`, `lengthen`, `dropEdge`) only DELETE characters or join two tokens — none introduces a letter no token contains. The inventory is therefore exactly 46 onsets, 15 vowels, 25 codas, and **22 letters**: `a b c d e f g h i j k l m n o r s t u v y z` (no p, q, w, x).

- [ ] **Step 1: Write the failing test**

Create `src/engine/hangul.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { toHangul } from "./hangul";
import { endsWithConsonant } from "./korean";
import { generateWorld } from "./world";
import { DEFAULT_PARAMS } from "../types/world";
import { simulateHistory } from "./history";
import { buildDynasties } from "./dynasty";

describe("toHangul", () => {
  it("writes each digraph as the one sound it is", () => {
    expect(toHangul("Khaagg")).toBe("카아그");
    expect(toHangul("Thykhy")).toBe("시키");
    expect(toHangul("Dhaishdhar")).toBe("다이시다르");
  });

  it("gives a trailing consonant the syllable Korean gives it", () => {
    expect(toHangul("Sahias")).toBe("사히아스");
    expect(toHangul("Trous")).toBe("트로우스");
  });

  it("leaves no Latin letter anywhere, on any name any seed produces", () => {
    const bad: string[] = [];
    for (let seed = 1; seed <= 20; seed++) {
      const { world } = generateWorld({ ...DEFAULT_PARAMS, seed });
      const h = simulateHistory(world, seed);
      const names = [
        ...world.cities.map((c) => c.name),
        ...h.polities.map((p) => p.name),
        ...world.cultures.map((c) => c.name),
        ...[...buildDynasties(world, h).values()].flat().map((r) => r.name),
        ...world.regions.map((r) => r.label.proper ?? ""),
        ...world.rivers.map((r) => r.label.proper ?? ""),
      ].filter(Boolean);
      for (const n of names) if (/[A-Za-z]/.test(toHangul(n))) bad.push(`${n} -> ${toHangul(n)}`);
    }
    expect(bad, `${bad.length} names kept Latin, e.g. ${bad.slice(0, 8).join(", ")}`).toEqual([]);
  });

  it("is stable: one name is always written one way", () => {
    expect(toHangul("Krathgath")).toBe(toHangul("Krathgath"));
  });

  it("gives korean.ts a real final consonant instead of a guess", () => {
    // The particle rule reads the Latin LETTER today. Hangul removes the guess: 스 closes on ㅅ.
    expect(endsWithConsonant(toHangul("Sahias"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/engine/hangul.test.ts`
Expected: FAIL — `Failed to load url ./hangul`.

- [ ] **Step 3: Implement `src/engine/hangul.ts`**

Compose a syllable from the three Hangul jamo tables (a syllable is `0xac00 + (onset*21 + nucleus)*28 + coda`):

```ts
const ONSET = ["g","kk","n","d","tt","r","m","b","pp","s","ss","","j","jj","ch","k","t","p","h"];
const NUCLEUS = ["a","ae","ya","yae","eo","e","yeo","ye","o","wa","wae","oe","yo","u","weo","we","wi","yu","eu","ui","i"];
const CODA = ["","g","kk","gs","n","nj","nh","d","l","lg","lm","lb","ls","lt","lp","lh","m","b","bs","s","ss","ng","j","ch","k","t","p","h"];

function syllable(onset: number, nucleus: number, coda = 0): string {
  return String.fromCharCode(0xac00 + (onset * 21 + nucleus) * 28 + coda);
}
```

Then scan the word left to right with **longest match first**, against a rule table written as data with the source token in a comment beside each entry so the next reader can check it against `names.ts`:

- consonant digraphs before single letters: `th sh kh dh ch gg ck ph fj`
- vowel clusters before single vowels: `aa ae ai au ea ei ia io ou`
- a consonant with no vowel after it takes the filler nucleus `eu` (ㅡ), which is how Korean writes a foreign cluster
- a word-final `n l m ng k t p` becomes a CODA on the syllable before it rather than a syllable of its own; every other final consonant takes `eu`

- [ ] **Step 4: Run the test until it passes**

Run: `npx vitest run src/engine/hangul.test.ts`
Expected: PASS. The "no Latin left" case is the one that finds gaps — **fix the TABLE, never the test.**

- [ ] **Step 5: Full suite, then commit**

```bash
npx vitest run
git add src/engine/hangul.ts src/engine/hangul.test.ts
git commit -m "feat(names): write an invented name the way Korean writes a foreign one"
```

---

### Task 3: Korean rendering — this is where the map changes

**Files:**
- Modify: `src/engine/featureLabel.ts` (the Korean branch, plus `ADJ_KO` and `NOUN_KO`)
- Modify: `src/ui/svgWorldRenderer.ts:176` (region label), `:201` (river label), `:257` (city label), `:313` (world title)
- Modify: `src/ui/politicalLayer.ts` (realm labels and the nation legend rows)
- Modify: `src/ui/app.ts:259` (the list's realm column), `:360` (the list's city name)
- Modify: `src/ui/svgCityRenderer.ts:586` and `:122` (plate title and its `<title>`)
- Modify: `src/ui/cityFacts.ts` (the realm line)
- Modify: `src/engine/gazetteer.ts:143-160` and every Korean sentence that interpolates a name
- Test: `src/engine/featureLabel.test.ts`

**Interfaces:**
- Consumes: `featureLabel(label, lang)` (Task 1), `toHangul(word)` (Task 2).
- Produces: `export const ADJ_KO`, `export const NOUN_KO` and `export const WORLD_NOUN_KO`, all `Record<string, string>`, from `src/engine/featureLabel.ts`.

- [ ] **Step 1: Write the failing test**

Append to `src/engine/featureLabel.test.ts` (add `ADJ_KO`, `NOUN_KO`, `WORLD_NOUN_KO` to the import from `./featureLabel`, and `import { ADJ, NOUNS, WORLD_NOUN } from "./geography"; import { RIVER_NOUNS } from "./rivers";` — export those from their modules if they are not exported yet):

```ts
describe("featureLabel in Korean", () => {
  it("puts the noun last, and the proper name in front of its 의", () => {
    expect(featureLabel({ pattern: "adj", kind: ALPINE, adj: "Iron", noun: "Spires" }, "ko"))
      .toBe("무쇠 첨봉");
    expect(featureLabel({ pattern: "of", kind: ALPINE, noun: "Barrens", proper: "Dimbrerk" }, "ko"))
      .toBe("딤브레르크의 황무지");
    expect(featureLabel({ pattern: "attributive", kind: ALPINE, noun: "Wilds", proper: "Trianork" }, "ko"))
      .toBe("트리아노르크 야생지");
  });

  it("has a Korean word for every English one the generator can pick", () => {
    // 20 adjectives + 37 region nouns + 7 river nouns + 5 world nouns. A missing entry has to be a
    // failing test, not an English word surfacing on a Korean map.
    for (const a of ADJ) expect(ADJ_KO[a], `no Korean for adjective ${a}`).toBeTruthy();
    for (const list of Object.values(NOUNS)) for (const n of list) expect(NOUN_KO[n], `no Korean for noun ${n}`).toBeTruthy();
    for (const n of RIVER_NOUNS) expect(NOUN_KO[n], `no Korean for river noun ${n}`).toBeTruthy();
    for (const n of WORLD_NOUN) expect(WORLD_NOUN_KO[n], `no Korean for world noun ${n}`).toBeTruthy();
  });

  it("gives each English word its own Korean word", () => {
    // Task 4 exists to stop one map calling three places the same thing; a translation table that
    // collapses Moor and Barrens onto 황무지 would undo it in the other language.
    const all = Object.values(NOUN_KO);
    expect(new Set(all).size, `${all.length - new Set(all).size} Korean nouns are shared`).toBe(all.length);
  });

  it("still reproduces the English string it always did", () => {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 3 });
    for (const r of world.regions) expect(featureLabel(r.label, "en")).toBe(r.name);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/engine/featureLabel.test.ts`
Expected: FAIL — `ADJ_KO` is not exported, and the Korean renderer returns English.

- [ ] **Step 3: Add the tables and the Korean branch**

In `src/engine/featureLabel.ts`:

```ts
if (label.pattern === "adj") return `${ADJ_KO[label.adj!]} ${NOUN_KO[label.noun]}`;
if (label.pattern === "of") return `${toHangul(label.proper!)}의 ${NOUN_KO[label.noun]}`;
return label.noun ? `${toHangul(label.proper!)} ${NOUN_KO[label.noun]}` : toHangul(label.proper!);
```

Starting Korean, to be read as prose and revised freely as long as no two entries collide:

- **Adjectives:** Ashen 잿빛 · Grey 회색 · Green 푸른 · Golden 황금빛 · White 흰 · Black 검은 · Bitter 쓰라린 · Broken 부서진 · Endless 끝없는 · Silent 고요한 · Frozen 얼어붙은 · Shrouded 안개 덮인 · Sunken 가라앉은 · Hollow 텅 빈 · Iron 무쇠 · Amber 호박빛 · Pale 창백한 · Riven 갈라진 · Cold 차가운 · Old 오래된
- **Sea:** Sea 바다 · Deep 심해 · Gulf 만 · Waters 해역 · Expanse 대해 · Main 큰바다
- **Cold/forest:** Tundra 툰드라 · Frostlands 서리벌판 · Barrens 황무지 · Pinewood 침엽수림 · Taiga 타이가 · Wilds 야생지 · Forest 숲 · Woods 수풀 · Reach 벌판 · Wold 언덕숲
- **Open/dry:** Plains 평원 · Steppe 대초원 · Downs 구릉 · Fields 들판 · Wastes 황야 · Sands 모래벌판 · Dunes 사구
- **Wet/warm:** Jungle 밀림 · Rainforest 우림 · Marsh 습지 · Fens 늪 · Mire 수렁 · Moor 진펄
- **High:** Peaks 봉우리 · Mountains 산맥 · Range 연봉 · Spires 첨봉 · Heights 고지
- **Rivers:** River 강 · Water 물줄기 · Run 개울 · Fork 갈래 · Flow 흐름 · Race 급류 · Rill 실개천
- **World:** Realm 왕토 · Lands 땅 · Reaches 변방 · Dominion 강역 · Expanse 대지

⚠ `Expanse` is in BOTH the ocean nouns and the world nouns, and wants a different Korean word in
each (대해 for a sea, 대지 for a world). So the world nouns get their OWN table — which is what the
source already does, `WORLD_NOUN` being separate from `NOUNS`:

```ts
export const WORLD_NOUN_KO: Record<string, string> = {
  Realm: "왕토", Lands: "땅", Reaches: "변방", Dominion: "강역", Expanse: "대지",
};
```

`featureLabel` picks `WORLD_NOUN_KO` when `kind === -1` and the pattern is `adj` (only the world
name takes that shape with `kind === -1`; a river never uses the `adj` pattern with a world noun).
The uniqueness test below therefore runs over `NOUN_KO` alone.

- [ ] **Step 4: Run the test green, then wire every display site**

Each site already receives the language it renders in; pass it through:
`lang === "ko" ? featureLabel(r.label, "ko") : r.name` for regions and rivers, `lang === "ko" ? toHangul(c.name) : c.name` for cities, realms, peoples and rulers.
**Drop `.toUpperCase()` when the language is Korean** — it does nothing to Hangul, and the size and letter-spacing already carry the register.

- [ ] **Step 5: Verify in a browser, not by reasoning**

```bash
npm run build
```

Open the `worldmaker-preview` config (port 4173) at `map.html?v=1#seed=1` — **a production build, because the dev server hands the browser a CSS/JS module it then caches, which has already produced one measurement of yesterday's code in this project.** Switch to Korean and assert in the console:

```js
[...document.querySelectorAll('svg.world text')].filter(t => !t.closest('.legend') && /[A-Za-z]/.test(t.textContent)).map(t => t.textContent)
```

Expected: `[]`. Also count visible labels in Korean and in English on the same seed — a name that got longer must not push a neighbour off the map.

- [ ] **Step 6: Re-pin the Korean hashes and commit**

`npx vitest run` will fail `gazetteer.test.ts` on the `ko` FNV for seeds 1/2/3. **Confirm the line counts still read 123/130/105** — a moved count means a sentence was added or lost, which is a bug and not a translation. Record what was allowed to move in the comment block above `pins`.

```bash
git add -A
git commit -m "feat(names): a Korean map that is written in Korean"
```

---

### Task 4: Stop one map calling three places the same thing

**Files:**
- Modify: `src/engine/geography.ts` (`nameGeography`)
- Test: `src/engine/geography.test.ts`

**Interfaces:**
- Consumes: `featureName` from Task 1.
- Produces: no signature change.

- [ ] **Step 1: Write the failing test**

```ts
it("does not use one noun twice on the same map", () => {
  // Measured before this existed: 15 of 20 worlds repeated a region noun, because `Wilds` is
  // registered in three biome tables at once and took 22 of 247 regions.
  let repeats = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed });
    const nouns = world.regions.map((r) => r.label.noun);
    if (new Set(nouns).size !== nouns.length) repeats++;
  }
  expect(repeats, `${repeats} of 20 worlds repeat a region noun`).toBe(0);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/engine/geography.test.ts`
Expected: FAIL — `15 of 20 worlds repeat a region noun: expected 15 to be 0`.

- [ ] **Step 3: Walk to the next unused noun instead of redrawing**

In `nameGeography`, keep a `Set` of nouns already used; when `featureName` returns one that is taken, walk that biome's own list from the drawn index to the next free entry and rebuild both `name` and `label.noun` from it. **Walking is not drawing** — the rng is untouched, which is exactly the technique `lengthen()` in `names.ts` already uses. If a biome's whole list is spoken for, keep the repeat rather than borrowing another biome's word.

- [ ] **Step 4: Run the full suite**

`world.test.ts` and `history.test.ts` must still pass untouched — no draw moved. The English gazetteer WILL move; this is the one task allowed to move it.

- [ ] **Step 5: Re-pin English (and Korean) and commit**

Re-pin both hashes in `gazetteer.test.ts` with the reason recorded, and any test that names a region literally.

```bash
git add -A
git commit -m "fix(names): a map that does not call three places the same thing"
```

---

### Task 5: Korean suffixes for realms and peoples

**Files:**
- Create: `src/engine/nameSuffix.ts`
- Test: `src/engine/nameSuffix.test.ts`
- Modify: `src/ui/politicalLayer.ts` (realm labels + legend rows), `src/ui/app.ts:259` (list realm column), `src/ui/cityFacts.ts` (plate realm line), `src/engine/gazetteer.ts` (Korean realm headings)

**Interfaces:**
- Consumes: `classifyGovernments(world, history)` from `src/engine/government.ts`, which returns `Map<number, { form: "kingdom" | "republic" | "empire"; since: number | null }>`; `toHangul` from Task 2.
- Produces:
  ```ts
  export function realmLabelKo(name: string, form: "kingdom" | "republic" | "empire"): string;
  export function peopleLabelKo(name: string): string;
  ```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { realmLabelKo, peopleLabelKo } from "./nameSuffix";

describe("Korean says what kind of thing a name is", () => {
  it("names a realm by the kind of state it is", () => {
    expect(realmLabelKo("Ceusdu", "kingdom")).toBe("케우스두 왕국");
    expect(realmLabelKo("Hreir", "republic")).toBe("흐레이르 공화국");
    expect(realmLabelKo("Zaiashain", "empire")).toBe("자이아샤인 제국");
  });
  it("marks a people as a people rather than as a place", () => {
    expect(peopleLabelKo("Druthvrau")).toBe("드루스브라우인");
  });
});
```

- [ ] **Step 2: Run it, watch it fail, implement, run it green**

Run: `npx vitest run src/engine/nameSuffix.test.ts` — FAIL, then implement over `toHangul`, then PASS.

- [ ] **Step 3: Wire the four LABEL sites, and not the sentences**

Map realm labels, the nation legend rows, the city list's realm column, the plate's realm line, and the Korean gazetteer's realm headings. **Not inside chronicle sentences** — "케우스두 왕국이 …를 정복" reads as a translation of an English sentence rather than as a chronicle. The rule: a name that stands alone as a label takes the suffix; a name inside a clause does not.

- [ ] **Step 4: Verify in the browser, then commit**

Same production-preview check as Task 3, plus: count visible labels in Korean against English on seed 1 at 1920x945 and confirm the longer realm labels cost the map no city names.

```bash
git add -A
git commit -m "feat(names): let a Korean map say which of these is a kingdom"
```

---

### Task 6: Deploy and verify live

- [ ] **Step 1: Full green and a build**

```bash
npx vitest run && npx tsc --noEmit && npm run build
```

- [ ] **Step 2: Push, then wait for the asset you built**

```bash
git push origin main
```

Poll `https://kutanxx.github.io/WorldMaker/map.html` until it references the `map-*.js` filename in your local `dist/map.html`. **The hash is the proof** — a live check against a stale asset has fooled this project before.

- [ ] **Step 3: Verify on the live site, in Korean**

At 1920x945 on seed 1 with the UI in Korean: no visible map label matches `/[A-Za-z]/`; the downloaded gazetteer carries Korean region and river names; the console has zero errors. Record the numbers rather than the impression.

- [ ] **Step 4: Update the memory files**

`worldmaker-backlog.md` (a dated entry and the new `origin/main`), `MEMORY.md` (the commit), and any gotcha worth keeping in `worldmaker-status.md`.
