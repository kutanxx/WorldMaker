# Chronicle Localization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The recorded chronicle — on screen and in the exported gazetteer — is told in the language the reader chose, instead of always in Korean.

**Architecture:** `HistoryEvent` stops carrying a finished Korean sentence and carries data again (ids, plus the two names no id can recover). One pure module, `src/engine/eventText.ts`, assembles the sentence per language, and both readers — the chronicle panel and the gazetteer — call it. The Korean output is byte-identical to today's, which is what lets every existing golden anchor stay pinned.

**Tech Stack:** TypeScript (strict, `noUnusedLocals`), Vite MPA, vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-05-chronicle-localization-design.md`

## Global Constraints

- **Every existing golden number in the repo must reproduce untouched.** `history.test.ts` anchors for seeds 1/2/3 (`snaps`/`pols`/`evs`/`econ`/`allSnap`/`events`/`polities`) and `world.test.ts`'s `polityOf` = 1350115163, `cityCells` = 4294534188, 28 cities. If one moves, STOP — the change is not text-only. Do not re-pin.
- **Korean output stays byte-identical.** This task fixes English; it does not rewrite Korean.
- **No rng draw may shift.** `s.nameGen.place()` and `s.nameGen.nation()` must be called exactly where and as often as they are called today.
- English chronicle voice is fixed by `minedChronicle` in `gazetteer.ts`: `Year <n> — ` followed by a present-tense clause. The two are interleaved into one list.
- Run vitest from the repo root `C:\projects\WorldMaker` (`npx vitest run <path>`).
- Do not commit to `main` without the user's word; commit as you go, push only when asked.

---

### Task 1: Carry the names a sentence cannot recover

Three of the seven events name something that no id can reach: the free port's name, the city a realm founds, and a civil war's successor states. Today those names exist only inside the finished sentence. This task stores them on the event, while leaving `text` in place so nothing breaks yet.

**Files:**
- Modify: `src/engine/historySim.ts` (interface at 69-72; emission sites at 274, 439, 486)
- Test: `src/engine/history.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `HistoryEvent.name?: string` and `HistoryEvent.intoIds?: number[]`, populated for `staple`, `newCity` and `civilwar` respectively.

- [ ] **Step 1: Write the failing test**

Append inside the existing top-level `describe` block of `src/engine/history.test.ts` (it already has the `build(seed)` helper):

```ts
it("carries the names a sentence cannot recover from ids", () => {
  const h = simulateHistory(build(1), 1);
  let ports = 0, cities = 0, wars = 0;
  for (const e of h.events) {
    if (e.type === "staple") { ports++; expect(e.name).toBeTruthy(); expect(e.text).toContain(e.name!); }
    if (e.type === "newCity") { cities++; expect(e.name).toBeTruthy(); expect(e.text).toContain(e.name!); }
    if (e.type === "civilwar") {
      wars++;
      expect(e.intoIds!.length).toBeGreaterThanOrEqual(1);
      // the successors named in the sentence are exactly the ids recorded, in the same order
      expect(e.text).toContain(e.intoIds!.map((id) => h.polities[id].name).join("·"));
    }
  }
  expect(ports).toBe(3);   // seed 1: three free ports
  expect(cities).toBe(6);  // six cities founded
  expect(wars).toBe(1);    // one civil war
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/engine/history.test.ts -t "cannot recover"`
Expected: FAIL — TypeScript rejects `e.name` / `e.intoIds`, which do not exist on `HistoryEvent`.

- [ ] **Step 3: Add the two fields to the interface**

In `src/engine/historySim.ts`, replace lines 69-72:

```ts
export interface HistoryEvent {
  year: number; type: HistoryEventType; text: string;
  polityId: number; otherId?: number; cell?: number;
  /** a name the simulation coined that no id can recover: the city `newCity` founds,
      the free port `staple` designates */
  name?: string;
  /** the successor states a civil war split a realm into (ids into `polities`) */
  intoIds?: number[];
}
```

- [ ] **Step 4: Populate them at the three emission sites**

`staple` (line 274) — add `name: z.name`:

```ts
  for (const z of economicZones) events.push({ year: 0, type: "staple", text: `0년, ${z.name} 자유무역항 지정`, name: z.name, polityId: owner[z.cell] >= 0 ? owner[z.cell] : -1, cell: z.cell });
```

`civilwar` (line 439) — `capPolity` already holds the successor ids at indices 1..n, computed before the pushes:

```ts
    s.events.push({ year, type: "civilwar", text: `${year}년, 내란이 ${withJosa(s.polities[o].name, "을/를")} ${withJosa(names.join("·"), "으로/로")} 쪼갬`, intoIds: capPolity.slice(1), polityId: o, cell: s.capitals[o] });
```

`newCity` (line 486) — hoist the name generator call out of the template. **This is the one rng-sensitive edit in the plan.** `s.nameGen.place()` is called exactly once either way, and nothing before it in the template draws rng, so the draw order is unchanged:

```ts
    const cityName = s.nameGen.place();
    s.events.push({ year, type: "newCity", text: `${year}년, ${withJosa(s.polities[o].name, "이/가")} ${cityName} 건설`, name: cityName, polityId: o, cell: s.capitals[o] });
```

- [ ] **Step 5: Run the test and the golden anchors**

Run: `npx vitest run src/engine/history.test.ts src/engine/world.test.ts`
Expected: PASS, **including every anchor at its current pinned value.** If `allSnap`, any count, or `world.test.ts`'s hashes moved, the `newCity` hoist shifted an rng draw — revert and stop.

- [ ] **Step 6: Commit**

```bash
git add src/engine/historySim.ts src/engine/history.test.ts
git commit -m "$(cat <<'EOF'
refactor(history): record the names a sentence cannot recover from ids

The free port's name, the city a realm founds and a civil war's
successors existed only inside the finished Korean sentence. Store them
on the event so the sentence can be assembled later, in any language.
The newCity name generator call is hoisted out of the template and still
draws exactly once — every golden anchor reproduces untouched.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: The renderer

A pure module that turns one event into one sentence in one language. It lives in `engine/` because `gazetteer.ts` is an engine module and needs it.

**Files:**
- Create: `src/engine/eventText.ts`
- Test: `src/engine/eventText.test.ts`

**Interfaces:**
- Consumes: `HistoryEvent.name` / `HistoryEvent.intoIds` from Task 1.
- Produces: `export type EventLang = "en" | "ko"` and `export function eventText(e: HistoryEvent, polities: HistoryPolity[], lang: EventLang): string`. The returned string includes its own year prefix.

- [ ] **Step 1: Write the failing test**

Create `src/engine/eventText.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { generateWorld } from "./world";
import { DEFAULT_PARAMS } from "../types/world";
import { simulateHistory } from "./history";
import { eventText } from "./eventText";
import type { HistoryEvent, HistoryPolity } from "./historySim";

const build = (seed: number) => generateWorld({ ...DEFAULT_PARAMS, seed }).world;

// A minimal polity is enough for the renderer: it only ever reads `name`.
const P = (id: number, name: string): HistoryPolity =>
  ({ id, name, color: "#000", capital: 0, foundedYear: 0, endedYear: null, origin: "initial", free: false });

describe("eventText — Korean is byte-identical to what the simulation used to write", () => {
  // The temporary equivalence proof. `text` is removed in the next task; from then on the events
  // golden anchor in history.test.ts enforces this same property across seeds 1, 2 and 3.
  for (const seed of [1, 2, 3]) {
    it(`reproduces every recorded sentence on seed ${seed}`, () => {
      const h = simulateHistory(build(seed), seed);
      expect(h.events.length).toBeGreaterThan(0);
      for (const e of h.events) expect(eventText(e, h.polities, "ko")).toBe(e.text);
    });
  }

  it("reproduces seed 1's chronicle line for line", () => {
    const h = simulateHistory(build(1), 1);
    expect(h.events.map((e) => eventText(e, h.polities, "ko"))).toEqual([
      "0년, Dhaishdhar 건국",
      "0년, Korvruk 건국",
      "0년, Khokgraur 건국",
      "0년, Bryrbrok 건국",
      "0년, Kaarkgruau 건국",
      "0년, Zaiashain 건국",
      "0년, Vaealelael 건국",
      "0년, Fovok 건국",
      "0년, Forthor 자유무역항 지정",
      "0년, Eleir 자유무역항 지정",
      "0년, Sah 자유무역항 지정",
      "10년, Korvruk 황금기 도래",
      "20년, Bryrbrok 황금기 도래",
      "20년, Vaealelael이 Noun 건설",
      "30년, Vaealelael이 Khokgraur을 정복",
      "30년, Zaiashain 황금기 도래",
      "30년, Vaealelael이 Thu 건설",
      "40년, Vaealelael 황금기 도래",
      "60년, Vaealelael이 Stothglaem 건설",
      "70년, Korvruk이 Kaarkgruau를 정복",
      "80년, Zaiashain이 Fovok을 정복",
      "120년, Vaealelael이 Korvruk을 정복",
      "140년, 내란이 Zaiashain을 Komtros·Thaendfoul로 쪼갬",
      "140년, Thaendfoul이 Lan 건설",
      "170년, Zaiashain이 Dhaishdhar을 정복",
      "180년, Thaendfoul이 Kal 건설",
      "190년, 자유도시 Sah 독립 선포",
      "200년, Zaiashain이 Lulfia 건설",
      "320년, 자유도시 Graurk 독립 선포",
      "330년, 자유도시 Eleirlieiel 독립 선포",
      "430년, 자유도시 Meleil 독립 선포",
    ]);
  });
});

describe("eventText — English", () => {
  it("tells seed 1's chronicle in the gazetteer's own voice", () => {
    const h = simulateHistory(build(1), 1);
    expect(h.events.map((e) => eventText(e, h.polities, "en"))).toEqual([
      "Year 0 — Dhaishdhar is founded",
      "Year 0 — Korvruk is founded",
      "Year 0 — Khokgraur is founded",
      "Year 0 — Bryrbrok is founded",
      "Year 0 — Kaarkgruau is founded",
      "Year 0 — Zaiashain is founded",
      "Year 0 — Vaealelael is founded",
      "Year 0 — Fovok is founded",
      "Year 0 — Forthor is named a free port",
      "Year 0 — Eleir is named a free port",
      "Year 0 — Sah is named a free port",
      "Year 10 — a golden age dawns in Korvruk",
      "Year 20 — a golden age dawns in Bryrbrok",
      "Year 20 — Vaealelael founds Noun",
      "Year 30 — Vaealelael conquers Khokgraur",
      "Year 30 — a golden age dawns in Zaiashain",
      "Year 30 — Vaealelael founds Thu",
      "Year 40 — a golden age dawns in Vaealelael",
      "Year 60 — Vaealelael founds Stothglaem",
      "Year 70 — Korvruk conquers Kaarkgruau",
      "Year 80 — Zaiashain conquers Fovok",
      "Year 120 — Vaealelael conquers Korvruk",
      "Year 140 — civil war splits Zaiashain into Komtros and Thaendfoul",
      "Year 140 — Thaendfoul founds Lan",
      "Year 170 — Zaiashain conquers Dhaishdhar",
      "Year 180 — Thaendfoul founds Kal",
      "Year 190 — the free city of Sah declares independence",
      "Year 200 — Zaiashain founds Lulfia",
      "Year 320 — the free city of Graurk declares independence",
      "Year 330 — the free city of Eleirlieiel declares independence",
      "Year 430 — the free city of Meleil declares independence",
    ]);
  });

  it("says nothing in Korean", () => {
    const h = simulateHistory(build(1), 1);
    for (const e of h.events) expect(eventText(e, h.polities, "en")).not.toMatch(/[가-힣]/);
  });
});

describe("eventText — the parts a single seed does not exercise", () => {
  const pols = [P(0, "Aeltha"), P(1, "Bryn"), P(2, "Corran"), P(3, "Dhaish")];
  const war = (intoIds: number[]): HistoryEvent =>
    ({ year: 300, type: "civilwar", text: "", polityId: 0, intoIds });

  it("joins three successors as a sentence, not as an array", () => {
    expect(eventText(war([1, 2, 3]), pols, "en"))
      .toBe("Year 300 — civil war splits Aeltha into Bryn, Corran and Dhaish");
    // "Dhaish" closes on a consonant and is not ㄹ, so it takes 으로. (The ㄹ exception — a name
    // ending in l/r takes 로 — is covered by seed 1's real line, "…Thaendfoul로 쪼갬".)
    expect(eventText(war([1, 2, 3]), pols, "ko"))
      .toBe("300년, 내란이 Aeltha를 Bryn·Corran·Dhaish으로 쪼갬");
  });

  it("picks the Korean particle from the name's final sound", () => {
    // 받침 있는 이름 → 을, 없는 이름 → 를; and the civil-war particle follows the LAST successor.
    const consonant = [P(0, "Vaealelael"), P(1, "Khokgraur")];
    const vowel = [P(0, "Vaealelael"), P(1, "Kaarkgruau")];
    const conquer = (year: number): HistoryEvent =>
      ({ year, type: "conquer", text: "", polityId: 0, otherId: 1 });
    expect(eventText(conquer(30), consonant, "ko")).toBe("30년, Vaealelael이 Khokgraur을 정복");
    expect(eventText(conquer(70), vowel, "ko")).toBe("70년, Vaealelael이 Kaarkgruau를 정복");
  });

  it("prints an unknown id rather than throwing", () => {
    const orphan: HistoryEvent = { year: 10, type: "conquer", text: "", polityId: 0, otherId: 99 };
    expect(() => eventText(orphan, pols, "en")).not.toThrow();
    expect(eventText(orphan, pols, "en")).toBe("Year 10 — Aeltha conquers 99");
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/engine/eventText.test.ts`
Expected: FAIL — `Cannot find module './eventText'`.

- [ ] **Step 3: Write the module**

Create `src/engine/eventText.ts`:

```ts
import type { HistoryEvent, HistoryPolity } from "./historySim";
import { withJosa } from "./korean";

export type EventLang = "en" | "ko";

// "a and b"; "a, b and c". A realm's successors are a sentence, not an array.
function joinEn(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

// One sentence per recorded event, assembled in the reader's language at the moment it is read.
// The simulation stores ids and the handful of names no id can recover; the words are chosen here.
//
// The English voice is not free: these lines are interleaved with `minedChronicle`'s in
// gazetteer.ts, so they take its form — "Year <n> — " and a present-tense clause. The Korean is
// byte-identical to the sentences the simulation used to build, and the golden anchor in
// history.test.ts holds it that way.
export function eventText(e: HistoryEvent, polities: HistoryPolity[], lang: EventLang): string {
  const nameOf = (id: number) => polities[id]?.name ?? String(id);
  const ko = lang === "ko";
  const y = e.year;
  const self = nameOf(e.polityId);
  switch (e.type) {
    case "found":
      return ko ? `${y}년, ${self} 건국` : `Year ${y} — ${self} is founded`;
    case "staple":
      return ko ? `${y}년, ${e.name ?? ""} 자유무역항 지정`
                : `Year ${y} — ${e.name ?? ""} is named a free port`;
    case "goldenage":
      return ko ? `${y}년, ${self} 황금기 도래` : `Year ${y} — a golden age dawns in ${self}`;
    case "newCity":
      return ko ? `${y}년, ${withJosa(self, "이/가")} ${e.name ?? ""} 건설`
                : `Year ${y} — ${self} founds ${e.name ?? ""}`;
    case "conquer": {
      const prey = nameOf(e.otherId ?? -1);
      return ko ? `${y}년, ${withJosa(self, "이/가")} ${withJosa(prey, "을/를")} 정복`
                : `Year ${y} — ${self} conquers ${prey}`;
    }
    case "civilwar": {
      const heirs = (e.intoIds ?? []).map(nameOf);
      // the Korean particle is chosen from the joined list, i.e. from the LAST successor's name
      return ko ? `${y}년, 내란이 ${withJosa(self, "을/를")} ${withJosa(heirs.join("·"), "으로/로")} 쪼갬`
                : `Year ${y} — civil war splits ${self} into ${joinEn(heirs)}`;
    }
    case "independence":
      return ko ? `${y}년, 자유도시 ${self} 독립 선포`
                : `Year ${y} — the free city of ${self} declares independence`;
  }
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/engine/eventText.test.ts`
Expected: PASS. If a name in a fixture differs, the fixture is wrong, not the renderer — correct the fixture from the actual output.

- [ ] **Step 5: Commit**

```bash
git add src/engine/eventText.ts src/engine/eventText.test.ts
git commit -m "$(cat <<'EOF'
feat(chronicle): assemble the sentence in the reader's language

One pure renderer per event, per language, in the voice the gazetteer's
mined chronicle already established — the two are interleaved into one
list, so a second voice would read as a defect. Korean comes out
byte-identical, checked line for line against what the simulation wrote.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Retire `text`, and let the document speak English

Removing the field is what makes the renderer the single source of truth. The gazetteer already knows its language, so this is also the task that meets the acceptance criterion.

**Files:**
- Modify: `src/engine/historySim.ts` (interface + all 7 emission sites)
- Modify: `src/engine/history.test.ts` (the events golden fold; delete the Task-1 `text` assertions)
- Modify: `src/engine/gazetteer.ts:458`
- Modify: `src/ui/chronicle.ts:28`
- Modify: `src/engine/eventText.test.ts` (delete the now-redundant equivalence block)
- Test: `src/engine/gazetteer.test.ts`

**Interfaces:**
- Consumes: `eventText(e, polities, lang)` from Task 2.
- Produces: `HistoryEvent` without `text`. Any later reader must call `eventText`.

- [ ] **Step 1: Write the failing test**

Add to `src/engine/gazetteer.test.ts`, inside the existing `describe("worldToGazetteer")`:

```ts
it("writes an English document with no Korean left in it", () => {
  const en = worldToGazetteer(world, history, "en");
  const hangul = en.match(/[가-힣]/g) ?? [];
  expect(hangul).toEqual([]);          // shows the offending characters when it fails
});

it("still writes the Korean document in Korean", () => {
  const kr = worldToGazetteer(world, history, "ko");
  expect(kr).toContain("건국");
  expect(kr).toContain("## 연대기");   // adjust to the actual KO chronicle header if it differs
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/engine/gazetteer.test.ts -t "no Korean left"`
Expected: FAIL — the English document still carries the recorded events verbatim in Korean.

If the second test fails on the header string, read the actual Korean header out of `gazetteer.ts` and correct the assertion; that one is a guard, not the point of the task.

- [ ] **Step 3: Point both readers at the renderer**

`src/engine/gazetteer.ts` — add the import at the top and change line 458:

```ts
import { eventText } from "./eventText";
```
```ts
    told.push({ year: ev.year, rank: 0, text: eventText(ev, history.polities, lang) });
```

`src/ui/chronicle.ts` — add the import and change line 28. The hardcoded `"ko"` is deliberate and temporary; Task 4 gives the panel its language:

```ts
import { eventText } from "../engine/eventText";
```
```ts
    row.textContent = eventText(e, history.polities, "ko"); // Task 4 gives the panel its language
```

- [ ] **Step 4: Remove `text` from the interface and all seven emission sites**

In `src/engine/historySim.ts`, drop `text: string;` from `HistoryEvent`, then delete the `text: \`...\`,` fragment from each of the seven `push` calls (lines 266, 274, 408, 439, 466, 476, 486). Two of them lose their last use of `withJosa`, and `civilwar` loses its last use of the local `names` array — **`noUnusedLocals` is on, so both must go**:

- In the `civilwar` block, `names` is still needed to... nothing. Delete `const names: string[] = [];` and the `names.push(nm);` line, and keep `const nm = s.nameGen.nation();` exactly where it is — it is an rng draw and must not move. If `nm` then has only its one use in the `polities.push`, that is fine.
- If `withJosa` ends up unused in `historySim.ts`, delete its import (line 5).

- [ ] **Step 5: Fold the Korean rendering into the events golden hash**

In `src/engine/history.test.ts`, import the renderer and change the one fold:

```ts
import { eventText } from "./eventText";
```
```ts
        ev = fold(ev, (e.otherId ?? -1) + 1); ev = fold(ev, (e.cell ?? -1) + 1);
        ev = fold(ev, fnvStr(eventText(e, h.polities, "ko")));
```

Add this to the comment block above `anchors`, after the existing paragraph:

```
  // 2026-09-05: `HistoryEvent.text` was removed — the sentence is now assembled at display time by
  // eventText.ts. This fold renders the Korean line instead, and because that rendering is
  // byte-identical, NOTHING here was re-pinned. The rendered line also contains the new `name` and
  // `intoIds` values, so a wrong value in either fails this anchor.
```

Also delete the `expect(e.text).toContain(...)` assertions from the Task 1 test, keeping the counts and the `intoIds` check:

```ts
it("carries the names a sentence cannot recover from ids", () => {
  const h = simulateHistory(build(1), 1);
  let ports = 0, cities = 0, wars = 0;
  for (const e of h.events) {
    if (e.type === "staple") { ports++; expect(e.name).toBeTruthy(); }
    if (e.type === "newCity") { cities++; expect(e.name).toBeTruthy(); }
    if (e.type === "civilwar") { wars++; expect(e.intoIds!.length).toBeGreaterThanOrEqual(1); }
  }
  expect(ports).toBe(3);
  expect(cities).toBe(6);
  expect(wars).toBe(1);
});
```

- [ ] **Step 6: Delete the equivalence block in `eventText.test.ts`**

The `for (const seed of [1, 2, 3])` block compares against `e.text`, which no longer exists. Delete that loop only — keep the seed-1 line-for-line fixture. Replace the loop with a comment saying where the property now lives:

```ts
  // The across-seeds equivalence check lived here while `HistoryEvent.text` still existed. It is
  // now the events golden anchor in history.test.ts, which folds this exact rendering on seeds
  // 1, 2 and 3 and reproduces its pre-existing pinned values.
```

- [ ] **Step 7: Run the whole suite and the type check**

Run: `npx vitest run`
Expected: PASS, with **every anchor at its current pinned value** — nothing re-pinned.

Run: `npx tsc --noEmit`
Expected: clean. A `noUnusedLocals` error here means a dead local from Step 4 is still there.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(chronicle): the gazetteer tells the recorded history in English

HistoryEvent no longer carries a finished Korean sentence; the renderer
is the single source of truth and the exported document now follows the
reader's language all the way down. An English gazetteer contains no
Hangul at all, which is the thing this was for.

Every golden anchor reproduces untouched: the events hash folds the
Korean rendering, which is byte-identical, so nothing was re-pinned.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: The panel on screen

The chronicle panel still speaks Korean in an English session — its rows (hardcoded in Task 3), its title, and every century divider.

**Files:**
- Modify: `src/ui/i18n.ts` (header comment; two new functions after `biomeName`)
- Modify: `src/ui/chronicle.ts` (signature, title, era header, row text)
- Modify: `src/ui/app.ts:128`
- Test: `src/ui/chronicle.test.ts`

**Interfaces:**
- Consumes: `eventText` from Task 2.
- Produces: `renderChronicle(history: History, lang: Lang): HTMLElement` — the language parameter is **required**, so a caller that forgets it fails to compile. `chronicleTitle(lang, years)` and `eraLabel(lang, startYear)` from `i18n.ts`.

- [ ] **Step 1: Write the failing test**

Add to `src/ui/chronicle.test.ts`:

```ts
it("tells the chronicle in English, chrome and all", () => {
  const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
  const h = simulateHistory(world, 1);
  const el = renderChronicle(h, "en");
  expect(el.textContent).not.toMatch(/[가-힣]/);
  expect(el.querySelector("h3")!.textContent).toBe(`Chronicle (years 0–${h.years})`);
  expect(el.querySelector(".chronicle-era")!.textContent).toBe("0s");
  expect(el.querySelector(".chronicle-event")!.textContent).toBe("Year 0 — Dhaishdhar is founded");
});

it("still tells it in Korean when the reader is reading Korean", () => {
  const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 1 });
  const h = simulateHistory(world, 1);
  const el = renderChronicle(h, "ko");
  expect(el.querySelector("h3")!.textContent).toBe(`연대기 (0–${h.years}년)`);
  expect(el.querySelector(".chronicle-era")!.textContent).toBe("0년대");
  expect(el.textContent).toContain("건국");
});
```

Then update the three existing `renderChronicle(h)` calls in that file to `renderChronicle(h, "ko")`.

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/ui/chronicle.test.ts`
Expected: FAIL — `renderChronicle` takes one argument.

- [ ] **Step 3: Add the chrome strings to `i18n.ts`**

After `biomeName` (line 31), add:

```ts
// The chronicle panel's own chrome. The chronicle's LINES are assembled by `eventText.ts`, not
// here — these two interpolate a number, which is why they are functions and not `UI` keys.
export function chronicleTitle(lang: Lang, years: number): string {
  return lang === "ko" ? `연대기 (0–${years}년)` : `Chronicle (years 0–${years})`;
}
// matches the gazetteer's century headers: "100년대" / "100s"
export function eraLabel(lang: Lang, startYear: number): string {
  return lang === "ko" ? `${startYear}년대` : `${startYear}s`;
}
```

And correct the file's opening comment (lines 1-2), which currently claims the chronicle is out of scope:

```ts
// UI + label localisation (KO/EN). Scope: UI chrome, city district names, biome legend names,
// compass, and the chronicle panel's chrome. NOT generated content (world/region/city/nation/river
// names) and NOT the chronicle's own lines — those are assembled by `engine/eventText.ts`.
```

- [ ] **Step 4: Give the panel its language**

`src/ui/chronicle.ts`:

```ts
import type { History } from "../engine/history";
import type { Lang } from "./i18n";
import { chronicleTitle, eraLabel } from "./i18n";
import { eventText } from "../engine/eventText";

export function renderChronicle(history: History, lang: Lang): HTMLElement {
```
```ts
  title.textContent = chronicleTitle(lang, history.years);
```
```ts
      h.textContent = eraLabel(lang, century * 100);
```
```ts
    row.textContent = eventText(e, history.polities, lang);
```

`src/ui/app.ts:128`:

```ts
    const chronicle = renderChronicle(history, lang);
```

No further wiring: the language toggle already calls `showWorld()`, which rebuilds the chronicle from scratch.

- [ ] **Step 5: Run the tests and the build**

Run: `npx vitest run`
Expected: PASS, every anchor still at its pinned value.

Run: `npm run build`
Expected: clean (`tsc --noEmit` then `vite build`).

- [ ] **Step 6: See it in the running app**

The harness cannot screenshot this app, but the DOM carries the whole answer. Start the dev server via the Browser pane (never `npm run dev` in a shell), open `map.html`, and read the panel back:

```js
// after the world renders, with the language toggle on EN
const rows = [...document.querySelectorAll(".chronicle-event")].map(r => r.textContent);
({ title: document.querySelector(".chronicle h3").textContent,
   era: document.querySelector(".chronicle-era").textContent,
   first: rows[0], hangul: rows.filter(t => /[가-힣]/.test(t)).length })
```

Expected: an English title, an English era header, and `hangul: 0`. Then click the language toggle and confirm the same query comes back Korean. Also click 📜 to export and confirm the download is English throughout.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(chronicle): the panel follows the reader's language too

The chronicle on screen was Korean in an English session down to its
title and century dividers. Its lines now come from the same renderer
the gazetteer uses, and its chrome from i18n. The language parameter is
required, so a caller cannot forget it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §1 the event becomes data again (`name`, `intoIds`, field table) | Task 1 |
| §1 `text` removed | Task 3 Step 4 |
| §2 `eventText.ts`, signature, fallback, English table, list joining | Task 2 |
| §3 panel chrome (`chronicleTitle`, `eraLabel`, i18n comment) | Task 4 Step 3 |
| §3 `renderChronicle(history, lang)`, no extra toggle wiring | Task 4 Steps 4 |
| §4 data flow — both readers on one renderer | Task 3 Step 3 |
| "what must not move": polities/events/allSnap anchors, world.test hashes, KO byte-identity | Global Constraints; Task 1 Step 5; Task 2 Step 1; Task 3 Steps 5, 7 |
| Testing 1 (seven types, both languages, particles, joins) | Task 2 Step 1 |
| Testing 2 (Korean regression lock) | Task 2 Step 1 |
| Testing 3 (golden hashes) | Task 3 Step 5 |
| Testing 4 (chronicle in English) | Task 4 Step 1 |
| Testing 5 (acceptance: zero Hangul in the English gazetteer) | Task 3 Step 1 |

No gaps.

**Placeholders:** none. Two steps say "adjust the assertion if the actual string differs" (Task 3 Step 2's Korean header, Task 2 Step 4's fixture names) — those are stated as fixture corrections against real output, not as work left undefined.

**Type consistency:** `eventText(e, polities, lang)` has the same three-parameter shape in Tasks 2, 3 and 4. `EventLang` (`"en" | "ko"`) and `i18n.ts`'s `Lang` (`"en" | "ko"`) are structurally identical, so passing a `Lang` where an `EventLang` is expected compiles — the same arrangement `gazetteer.ts` already uses with `GazetteerLang`. `renderChronicle`'s second parameter is required from Task 4 onward and is the only signature change to a public UI function.
