# Reign Legacy + Neighbor Attitude Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a reign ends it leaves a story behind (per-seed dynasty annals with epitaphs + a revenge badge), and during a reign every bordering rival wears an honest 3-state attitude with itemized reasons.

**Architecture:** Feature A (legacy): new pure UI module `src/ui/legacy.ts` (fixed-schema localStorage records, epitaph composition), wired into `playApp.ts`'s `end()` and `renderPicker()`. Feature B (attitude): new read-only helper `neighborAttitudes` in `src/engine/standing.ts`, rendered as a chip row + tooltips in the panel and icons in the peace select. Zero engine-behavior change; goldens untouched. Specs: `docs/superpowers/specs/2026-07-11-reign-legacy-design.md`, `.../2026-07-11-neighbor-attitude-design.md`.

**Tech Stack:** TypeScript, vitest (jsdom has working localStorage). No new dependencies.

## Global Constraints

- Goldens byte-identical; `neighborAttitudes` is read-only over SimState; attitude states must map to REAL behavioral guarantees (friendly=truce active, hostile=ratio≥`ATT_HOSTILE_RATIO=1.15` OR crisis hegemon, wary=else). Never display sim-unbacked personality.
- Legacy storage failures (quota/privacy/corrupt JSON) are silently non-fatal — reads → `[]`, writes try/caught.
- Legacy schema fixed: `LegacyEntry{v:1,n,nation,kind,cause,year,peakCells,citiesFounded,epitaph:{code,data}}`; `LEGACY_CAP=20`, `LEGACY_SHOW=5`; reign counter `n=(newest.n??0)+1` counts past the cap. Epitaphs stored language-neutral, localized at render.
- Every user-facing string in PLAY_UI/i18n KO+EN.
- `FrontEdge.enemy` is a CELL index — map through `s.owner[]`.
- `npm run build` runs `tsc --noEmit` with **noUnusedLocals** — removing a call site means removing the import.
- Run vitest from the worktree root `C:\projects\WorldMaker\.claude\worktrees\game-ui-benchmarking-1d8868`. Baseline: 440 tests green at `4d98c6a`.
- STRICT GIT: no reset/rebase/checkout/restore/clean (`git show` for history); `git add` only named files; verify branch + expected HEAD before each commit.

---

### Task 1: `src/ui/legacy.ts` — storage + epitaph module

**Files:**
- Create: `src/ui/legacy.ts`
- Test: Create `src/ui/legacy.test.ts`

**Interfaces:**
- Consumes: `DilemmaOutcome` (type-only, from `../engine/dilemma`).
- Produces (Task 2 relies on): `LegacyEntry`, `LegacyKind`, `EpitaphCode`, `LEGACY_CAP=20`, `LEGACY_SHOW=5`, `loadLegacy(seed, storage?)`, `recordReign(seed, entry, storage?)`, `seedBestPeak(entries)`, `composeEpitaph(kind, cause, highlights)`.

- [ ] **Step 1: Write the failing tests**

Create `src/ui/legacy.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { loadLegacy, recordReign, seedBestPeak, composeEpitaph, LEGACY_CAP, type LegacyEntry } from "./legacy";

function memStorage(): Pick<Storage, "getItem" | "setItem"> & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => { map.set(k, v); } };
}
const entry = (over: Partial<Omit<LegacyEntry, "v" | "n">> = {}): Omit<LegacyEntry, "v" | "n"> => ({
  nation: "Glounman", kind: "endurance", cause: "", year: 500, peakCells: 300, citiesFounded: 2,
  epitaph: { code: "epiEndured", data: {} }, ...over,
});

describe("legacy storage", () => {
  it("roundtrips, numbers reigns, and counts past the cap", () => {
    const st = memStorage();
    for (let i = 0; i < LEGACY_CAP + 3; i++) recordReign(7, entry({ peakCells: i }), st);
    const got = loadLegacy(7, st);
    expect(got.length).toBe(LEGACY_CAP);          // capped rows
    expect(got[0].n).toBe(LEGACY_CAP + 3);        // counter survives the cap
    expect(got[0].peakCells).toBe(LEGACY_CAP + 2); // newest first
  });
  it("never throws: corrupt JSON reads [], quota-throwing writes are swallowed", () => {
    const st = memStorage();
    st.map.set("wm:legacy:7", "{not json");
    expect(loadLegacy(7, st)).toEqual([]);
    const boom: Pick<Storage, "getItem" | "setItem"> = { getItem: () => null, setItem: () => { throw new Error("quota"); } };
    expect(() => recordReign(7, entry(), boom)).not.toThrow();
    expect(loadLegacy(7, null)).toEqual([]);       // no storage at all
  });
  it("seedBestPeak finds the record", () => {
    const st = memStorage();
    recordReign(7, entry({ peakCells: 100 }), st);
    recordReign(7, entry({ peakCells: 400 }), st);
    recordReign(7, entry({ peakCells: 250 }), st);
    expect(seedBestPeak(loadLegacy(7, st))).toBe(400);
  });
});

describe("composeEpitaph priority", () => {
  const hl = (code: string, name = "Nianthael") => ({ code, data: { name } });
  it("how it ended beats how it was lived", () => {
    expect(composeEpitaph("defeat", "Nianthael", [hl("hegemonVictory")]).code).toBe("epiFallen");
    expect(composeEpitaph("conquest", "", [hl("hegemonVictory")]).code).toBe("epiUnified");
  });
  it("hegemon victory > survived shadow > prophecy > golden age > endured", () => {
    expect(composeEpitaph("endurance", "", [hl("hegemonVictory")])).toEqual({ code: "epiSlewHegemon", data: { name: "Nianthael" } });
    expect(composeEpitaph("endurance", "", [hl("hegemonTribute")]).code).toBe("epiSurvivedShadow");
    expect(composeEpitaph("endurance", "", [{ code: "prophecyFulfilled", data: {} }]).code).toBe("epiProphecy");
    expect(composeEpitaph("prosperity", "", []).code).toBe("epiGoldenAge");
    expect(composeEpitaph("endurance", "", []).code).toBe("epiEndured");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/ui/legacy.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `src/ui/legacy.ts`**

```ts
// Reign legacy — the per-seed dynasty annals (Dwarf Fortress "the world persists" + the
// morgue-file lesson: a run record should read like a story). A fixed 7-field schema recorded
// only when a reign ENDS — deliberately NOT save/load, so there is no SimState migration tax.
import type { DilemmaOutcome } from "../engine/dilemma";

export const LEGACY_CAP = 20; // rows kept per seed (the reign counter keeps counting past it)
export const LEGACY_SHOW = 5; // rows the picker panel shows

export type LegacyKind = "conquest" | "prosperity" | "endurance" | "defeat";
export type EpitaphCode =
  | "epiFallen" | "epiUnified" | "epiSlewHegemon" | "epiSurvivedShadow"
  | "epiProphecy" | "epiGoldenAge" | "epiEndured";

export interface LegacyEntry {
  v: 1;
  n: number;                    // 제N대 — 1-based reign counter per seed
  nation: string;
  kind: LegacyKind;
  cause: string;                // conqueror name when kind === "defeat"
  year: number;
  peakCells: number;
  citiesFounded: number;
  epitaph: { code: EpitaphCode; data: Record<string, string | number> };
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;
const key = (seed: number) => `wm:legacy:${seed}`;
function defaultStorage(): StorageLike | null {
  try { return typeof localStorage !== "undefined" ? localStorage : null; } catch { return null; }
}

// reads never throw: corrupt JSON / missing storage / wrong shape all yield []
export function loadLegacy(seed: number, storage: StorageLike | null = defaultStorage()): LegacyEntry[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(key(seed));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((e) => e && e.v === 1 && typeof e.n === "number" && typeof e.nation === "string");
  } catch { return []; }
}

export function recordReign(seed: number, entry: Omit<LegacyEntry, "v" | "n">, storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  try {
    const prev = loadLegacy(seed, storage);
    const n = (prev[0]?.n ?? 0) + 1;
    const next: LegacyEntry[] = [{ v: 1, n, ...entry }, ...prev].slice(0, LEGACY_CAP);
    storage.setItem(key(seed), JSON.stringify(next));
  } catch { /* quota/privacy failures must never break the game */ }
}

export function seedBestPeak(entries: LegacyEntry[]): number {
  let best = 0;
  for (const e of entries) if (e.peakCells > best) best = e.peakCells;
  return best;
}

// the one sentence that tells the run's story — how it ended beats how it was lived
export function composeEpitaph(kind: LegacyKind, cause: string, highlights: DilemmaOutcome[]): LegacyEntry["epitaph"] {
  if (kind === "defeat") return { code: "epiFallen", data: { name: cause } };
  if (kind === "conquest") return { code: "epiUnified", data: {} };
  const slew = highlights.find((h) => h.code === "hegemonVictory");
  if (slew) return { code: "epiSlewHegemon", data: { name: String(slew.data.name ?? "") } };
  const shadow = highlights.find((h) => h.code === "hegemonRout" || h.code === "hegemonKneel" || h.code === "hegemonTribute");
  if (shadow) return { code: "epiSurvivedShadow", data: { name: String(shadow.data.name ?? "") } };
  if (highlights.some((h) => h.code === "prophecyFulfilled")) return { code: "epiProphecy", data: {} };
  if (kind === "prosperity") return { code: "epiGoldenAge", data: {} };
  return { code: "epiEndured", data: {} };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/ui/legacy.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ui/legacy.ts src/ui/legacy.test.ts
git commit -m "feat(play): legacy module — per-seed reign records with story epitaphs (fixed schema, failure-proof storage)"
```

---

### Task 2: Legacy wiring — record on end, annals panel + revenge badge in the picker

**Files:**
- Modify: `src/ui/playApp.ts` (`startGame` locals ~line 68-76, `renderDilemma`'s resolve handler, `end()` ~line 683, `renderPicker` ~line 48-66, imports)
- Modify: `src/ui/i18n.ts` (keys + `playLegacyEpitaph`)
- Modify: `src/theme.css` (append)
- Test: `src/ui/playApp.test.ts` (append)

**Interfaces:**
- Consumes: Task 1's module; `scorecard` from `../engine/playSim` (add to that existing import — reign.ts shows its shape: `{peakCells, cells, rank, nations, citiesHeld, citiesFounded, survivedYears, alive}`); `DilemmaOutcome` type from `../engine/dilemma`; `YEARS_PER_TICK` (already imported).
- Produces: `playLegacyEpitaph(lang, code, data): string` in i18n.

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/playApp.test.ts` (NOTE: jsdom localStorage persists across tests in a file — each test below starts with `localStorage.clear()`):

```ts
it("a finished reign is recorded in the world's annals, shown when picking again", () => {
  localStorage.clear();
  const root = document.createElement("div");
  createPlayApp(root, 1);
  (root.querySelector(".nation-choice") as HTMLButtonElement).click();
  for (let i = 0; i < 60; i++) {
    const adv = root.querySelector(".btn-advance") as HTMLButtonElement | null;
    if (!adv) break;
    adv.click();
  }
  expect(root.querySelector(".btn-play-again")).not.toBeNull(); // reached the banner
  (root.querySelector(".btn-play-again") as HTMLButtonElement).click();
  const panel = root.querySelector(".legacy-panel");
  expect(panel).not.toBeNull();
  const rows = root.querySelectorAll(".legacy-row");
  expect(rows.length).toBe(1);
  expect(rows[0].textContent).toContain("1"); // 제1대 / Reign 1
  expect((rows[0].textContent || "").length).toBeGreaterThan(15); // epitaph present
});

it("the conqueror's nation card wears the revenge badge after a defeat", () => {
  localStorage.clear();
  const probe = document.createElement("div");
  createPlayApp(probe, 1);
  const names = [...probe.querySelectorAll(".nation-choice .choice-title")].map((e) => e.textContent || "");
  expect(names.length).toBeGreaterThan(1);
  localStorage.setItem("wm:legacy:1", JSON.stringify([{
    v: 1, n: 3, nation: names[1], kind: "defeat", cause: names[0], year: 240,
    peakCells: 120, citiesFounded: 0, epitaph: { code: "epiFallen", data: { name: names[0] } },
  }]));
  const root = document.createElement("div");
  createPlayApp(root, 1);
  const cards = [...root.querySelectorAll(".nation-choice")];
  const conqueror = cards.find((c) => c.querySelector(".choice-title")?.textContent === names[0])!;
  expect(conqueror.querySelector(".revenge-badge")).not.toBeNull();
  const other = cards.find((c) => c.querySelector(".choice-title")?.textContent === names[1])!;
  expect(other.querySelector(".revenge-badge")).toBeNull();
});

it("corrupt legacy storage never breaks the picker", () => {
  localStorage.clear();
  localStorage.setItem("wm:legacy:1", "{broken");
  const root = document.createElement("div");
  createPlayApp(root, 1);
  expect(root.querySelectorAll(".nation-choice").length).toBeGreaterThan(0);
  expect(root.querySelector(".legacy-panel")).toBeNull();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/ui/playApp.test.ts`
Expected: the 3 new tests FAIL (no `.legacy-panel`/`.revenge-badge`); existing tests PASS. If any EXISTING picker test now fails from stray legacy state, add `localStorage.clear()` to it too (played-to-end tests write records now).

- [ ] **Step 3: Implement**

(a) i18n — add to `PLAY_UI.en`:

```ts
legacyTitle: "Annals of this world", legacyReignN: "Reign {n}", revenge: "☠ Vengeance",
```

and `PLAY_UI.ko`:

```ts
legacyTitle: "이 세계의 연대기", legacyReignN: "제{n}대", revenge: "☠ 복수전",
```

Add after `playDilemmaOutcome` in i18n.ts:

```ts
// legacy epitaphs are stored language-neutral ({code,data}) and localized here at render time
export function playLegacyEpitaph(lang: Lang, code: string, data: Record<string, string | number> = {}): string {
  const name = String(data.name ?? "");
  if (lang === "ko") {
    switch (code) {
      case "epiFallen": return `${name}의 손에 무너졌다`;
      case "epiUnified": return "천하를 통일했다";
      case "epiSlewHegemon": return `패권국 ${name}을(를) 결전에서 꺾었다`;
      case "epiSurvivedShadow": return `${name}의 그림자 아래에서 살아남았다`;
      case "epiProphecy": return "예언을 이루었다";
      case "epiGoldenAge": return "황금기를 이루었다";
      default: return "500년을 버텼다";
    }
  }
  switch (code) {
    case "epiFallen": return `Fell to ${name}`;
    case "epiUnified": return "Unified the known world";
    case "epiSlewHegemon": return `Broke the hegemon ${name} in battle`;
    case "epiSurvivedShadow": return `Endured beneath the shadow of ${name}`;
    case "epiProphecy": return "Fulfilled the prophecy";
    case "epiGoldenAge": return "Reigned into a golden age";
    default: return "Endured 500 years";
  }
}
```

(b) playApp imports: add `scorecard` to the existing `../engine/playSim` import; add `type DilemmaOutcome` to the `../engine/dilemma` import; add `playLegacyEpitaph` to the `./i18n` import; new line `import { loadLegacy, recordReign, seedBestPeak, composeEpitaph, LEGACY_SHOW } from "./legacy";`.

(c) In `startGame`, beside the other locals (~line 76): `const highlights: DilemmaOutcome[] = [];`

(d) In `renderDilemma`'s choice click handler, right after `const out = resolveDilemma(s, dilemma!, key);` add:

```ts
if (/^(hegemon|prophecy)/.test(out.code)) highlights.push(out); // legacy epitaph material
```

(e) In `end(kind, cause)`, after `dilemma = null;` add:

```ts
const sc = scorecard(s);
recordReign(seed, {
  nation: s.polities[s.playerPolity].name,
  kind, cause,
  year: s.tick * YEARS_PER_TICK,
  peakCells: sc.peakCells,
  citiesFounded: sc.citiesFounded,
  epitaph: composeEpitaph(kind, cause, highlights),
});
```

(f) In `renderPicker`, before the choices loop add `const legacy = loadLegacy(seed);` and inside the loop, after `b.innerHTML = ...`:

```ts
if (legacy[0]?.kind === "defeat" && legacy[0].cause === p.name) {
  const badge = document.createElement("span");
  badge.className = "revenge-badge";
  badge.textContent = playT(lang, "revenge");
  b.appendChild(badge);
}
```

and after the loop:

```ts
if (legacy.length) {
  const panel = document.createElement("div");
  panel.className = "legacy-panel";
  const h = document.createElement("div");
  h.className = "legacy-title";
  h.textContent = playT(lang, "legacyTitle");
  panel.appendChild(h);
  const best = seedBestPeak(legacy);
  const ICON: Record<string, string> = { conquest: "⚔", prosperity: "🏘", endurance: "👑", defeat: "☠" };
  for (const e of legacy.slice(0, LEGACY_SHOW)) {
    const row = document.createElement("div");
    row.className = "legacy-row";
    const star = best > 0 && e.peakCells === best ? " ★" : "";
    row.textContent =
      `${playT(lang, "legacyReignN").replace("{n}", String(e.n))} · ${e.nation} · ` +
      `${ICON[e.kind] ?? "•"} ${playYear(lang, e.year)} — “${playLegacyEpitaph(lang, e.epitaph.code, e.epitaph.data)}”${star}`;
    panel.appendChild(row);
  }
  root.appendChild(panel);
}
```

(g) Append to `src/theme.css`:

```css
/* per-seed reign annals on the nation picker */
.legacy-panel { max-width: 640px; margin: 14px auto 0; padding: 8px 14px; font-size: 12.5px; }
.legacy-title { font-weight: 700; color: #5a4a34; margin-bottom: 4px; }
.legacy-row { color: #4a3d2c; padding: 1px 0; }
.nation-choice .revenge-badge { display: inline-block; margin-left: 6px; font-size: 11px; color: #a63d36; font-weight: 700; }
```

- [ ] **Step 4: Run the playApp suite + full suite**

Run: `npx vitest run src/ui/playApp.test.ts` then `npx vitest run` — all PASS, `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add src/ui/playApp.ts src/ui/i18n.ts src/theme.css src/ui/playApp.test.ts
git commit -m "feat(play): reign legacy — annals of this world in the picker, epitaphs, revenge badge"
```

---

### Task 3: `neighborAttitudes` — honest 3-state derivation (engine/standing.ts)

**Files:**
- Modify: `src/engine/standing.ts`
- Test: `src/engine/standing.test.ts` (append; reuse the file's existing world/SimState fixture pattern — if it builds states via `generateWorld`+`initSim`, mirror that; the test code below assumes a local `playerState(seed)` helper you add matching `dilemma.test.ts`'s `biggestPlayerState` if none exists)

**Interfaces:**
- Consumes: `hostileNeighbors` (add to standing.ts's `../engine/intervention`-style import — note standing.ts imports from `./intervention`), `aggregate`, `frontEdges`, `s.dilemmaFlags`, `s.truces`.
- Produces (Task 4 relies on): `export type Attitude = "friendly" | "wary" | "hostile"`, `export const ATT_HOSTILE_RATIO = 1.15`, `export interface NeighborAttitude { id: number; name: string; att: Attitude; ratio: number; borderEdges: number; truceLeft: number; hegemon: boolean }`, `export function neighborAttitudes(s: SimState): NeighborAttitude[]` (sorted by `borderEdges` desc).

- [ ] **Step 1: Write the failing tests**

Append to `src/engine/standing.test.ts`:

```ts
describe("neighborAttitudes", () => {
  function playerState(seed: number) {
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed });
    const s = initSim(world, seed);
    const counts = new Map<number, number>();
    for (const o of s.owner) if (o >= 0) counts.set(o, (counts.get(o) ?? 0) + 1);
    s.playerPolity = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    return s;
  }

  it("truce ⇒ friendly (the engine literally skips their attacks); strength ⇒ hostile; else wary", () => {
    const s = playerState(1);
    const atts = neighborAttitudes(s);
    expect(atts.length).toBeGreaterThan(0);
    for (const a of atts) {
      if (a.truceLeft > 0) expect(a.att).toBe("friendly");
      else if (a.ratio >= ATT_HOSTILE_RATIO || a.hegemon) expect(a.att).toBe("hostile");
      else expect(a.att).toBe("wary");
    }
    // force a truce with the most-bordering rival and re-derive
    s.truces.set(atts[0].id, s.tick + 3);
    const after = neighborAttitudes(s).find((a) => a.id === atts[0].id)!;
    expect(after.att).toBe("friendly");
    expect(after.truceLeft).toBe(3);
  });

  it("the flagged crisis hegemon is hostile regardless of ratio; sorted by border pressure; read-only", () => {
    const s = playerState(1);
    const base = neighborAttitudes(s);
    const target = base.find((a) => a.truceLeft === 0)!;
    s.dilemmaFlags.add(`hegemonFoe:${target.id}`);
    const owner = [...s.owner];
    const atts = neighborAttitudes(s);
    expect(atts.find((a) => a.id === target.id)!.att).toBe("hostile");
    expect(atts.find((a) => a.id === target.id)!.hegemon).toBe(true);
    for (let i = 1; i < atts.length; i++) expect(atts[i - 1].borderEdges).toBeGreaterThanOrEqual(atts[i].borderEdges);
    expect([...s.owner]).toEqual(owner); // no mutation
  });
});
```

Add whatever imports the file lacks (`generateWorld`, `DEFAULT_PARAMS`, `initSim`, `neighborAttitudes`, `ATT_HOSTILE_RATIO`) alongside its existing ones.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/engine/standing.test.ts`
Expected: FAIL — `neighborAttitudes` not exported.

- [ ] **Step 3: Implement in `src/engine/standing.ts`**

Add `hostileNeighbors` to the existing `./intervention` import, then append:

```ts
// --- neighbor attitudes -----------------------------------------------------------------
// Honest 3-state diplomacy readability (TW/Paradox: attitude + itemized reasons). Each state
// maps to a REAL behavioral guarantee — friendly = truce active (stepSim skips their attacks
// on the player), hostile = they win border contests (bigger) or are the flagged crisis foe,
// wary = everything else. The Civ-agendas lesson: never display what the sim doesn't back.
export type Attitude = "friendly" | "wary" | "hostile";
export const ATT_HOSTILE_RATIO = 1.15; // their cells / ours at/above this ⇒ hostile

export interface NeighborAttitude {
  id: number; name: string;
  att: Attitude;
  ratio: number;        // their cells / player cells
  borderEdges: number;  // shared front edges (threat + push)
  truceLeft: number;    // ticks remaining, 0 if none
  hegemon: boolean;     // the crisis arc's flagged foe
}

export function neighborAttitudes(s: SimState): NeighborAttitude[] {
  if (s.playerPolity < 0) return [];
  const agg = aggregate(s);
  const mine = agg[s.playerPolity]?.cells ?? 0;
  const edgeCount = new Map<number, number>();
  for (const e of frontEdges(s)) {
    const p = s.owner[e.enemy]; // FrontEdge.enemy is a CELL index — owner[] maps it
    if (p >= 0) edgeCount.set(p, (edgeCount.get(p) ?? 0) + 1);
  }
  let hegemonId = -1;
  for (const f of s.dilemmaFlags) if (f.startsWith("hegemonFoe:")) hegemonId = Number(f.slice(11));
  const out: NeighborAttitude[] = [];
  for (const h of hostileNeighbors(s)) {
    const ratio = mine > 0 ? (agg[h.id]?.cells ?? 0) / mine : 0;
    const truceLeft = Math.max(0, h.trucedUntil - s.tick);
    const hegemon = h.id === hegemonId;
    const att: Attitude = truceLeft > 0 ? "friendly" : ratio >= ATT_HOSTILE_RATIO || hegemon ? "hostile" : "wary";
    out.push({ id: h.id, name: h.name, att, ratio, borderEdges: edgeCount.get(h.id) ?? 0, truceLeft, hegemon });
  }
  return out.sort((a, b) => b.borderEdges - a.borderEdges);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/engine/standing.test.ts`
Expected: PASS (existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add src/engine/standing.ts src/engine/standing.test.ts
git commit -m "feat(play): neighborAttitudes — honest 3-state attitude derived from truce/strength/crisis facts"
```

---

### Task 4: Attitude UI — neighbor chips + reason tooltips + peace-select icons

**Files:**
- Modify: `src/ui/playApp.ts` (`renderPanel` threat-line block; `renderActions` peace select; imports), `src/ui/i18n.ts` (keys), `src/theme.css` (append)
- Test: `src/ui/playApp.test.ts` (append)

**Interfaces:**
- Consumes: Task 3's `neighborAttitudes`/`NeighborAttitude`/`ATT_HOSTILE_RATIO` (import from `../engine/standing`, alongside the existing `computeStanding` import). Local const `NEIGHBOR_SHOW = 6`.
- Produces: nothing later tasks need.

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/playApp.test.ts`:

```ts
it("bordering rivals wear attitude chips whose tooltips itemize real factors", () => {
  localStorage.clear();
  const root = document.createElement("div");
  createPlayApp(root, 1);
  (root.querySelector(".nation-choice") as HTMLButtonElement).click();
  const chips = [...root.querySelectorAll(".neighbor-chip")];
  expect(chips.length).toBeGreaterThan(0);
  expect(chips.length).toBeLessThanOrEqual(6);
  const tip = (chips[0] as HTMLElement).title;
  expect(tip).toMatch(/x\d/);          // strength ratio line
  expect(tip.split("\n").length).toBeGreaterThanOrEqual(3); // itemized factors
});

it("peace options carry the attitude icon, and making peace flips the chip to friendly", () => {
  localStorage.clear();
  const root = document.createElement("div");
  createPlayApp(root, 1);
  (root.querySelector(".nation-choice") as HTMLButtonElement).click();
  const pce = root.querySelector(".peace-select") as HTMLSelectElement;
  const opt = pce.options[1]; // 0 is the placeholder
  expect(opt.textContent).toMatch(/^[⚔👁🤝]/);
  pce.value = opt.value;
  pce.dispatchEvent(new Event("change"));
  (root.querySelector(".btn-advance") as HTMLButtonElement).click();
  const name = (opt.textContent || "").replace(/^[⚔👁🤝]\s*/, "").replace(/\s*✓$/, "");
  const chip = [...root.querySelectorAll(".neighbor-chip")].find((c) => (c.textContent || "").includes(name));
  if (chip) expect(chip.className).toContain("friendly"); // still bordering after the tick ⇒ truced ⇒ 🤝
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/ui/playApp.test.ts -t "attitude"`
Expected: FAIL — no `.neighbor-chip`.

- [ ] **Step 3: Implement**

(a) i18n keys — `PLAY_UI.en`:

```ts
attFriendly: "friendly", attWary: "wary", attHostile: "hostile",
factBorder: "borders you on {n} edges", factRatio: "strength x{r}",
factStronger: "stronger", factWeaker: "weaker", factEven: "even",
factTruce: "truce — {n} turns left", factNoTruce: "no truce",
factHegemon: "⚠ the hegemon — your crisis foe", moreNeighbors: "+{n}",
```

`PLAY_UI.ko`:

```ts
attFriendly: "우호", attWary: "경계", attHostile: "적대",
factBorder: "국경 {n}칸 접촉", factRatio: "국력 x{r}",
factStronger: "우세", factWeaker: "열세", factEven: "비등",
factTruce: "휴전 {n}턴 남음", factNoTruce: "휴전 없음",
factHegemon: "⚠ 패권국 — 위기의 상대", moreNeighbors: "+{n}",
```

(b) playApp: extend the `../engine/standing` import with `neighborAttitudes` (and `ATT_HOSTILE_RATIO` if used for the word threshold below). Add near the other UI consts: `const NEIGHBOR_SHOW = 6;` and a shared icon map at module/startGame scope:

```ts
const ATT_ICON: Record<string, string> = { friendly: "🤝", wary: "👁", hostile: "⚔" };
```

In `renderPanel`, directly after the threat line is appended (`panel.appendChild(threat);`):

```ts
// neighbor attitude chips — TW/Paradox pattern: state icon + a tooltip that itemizes the
// REAL derived factors (never a personality the sim doesn't back)
const atts = neighborAttitudes(s);
if (atts.length) {
  const row = document.createElement("div");
  row.className = "neighbors";
  for (const a of atts.slice(0, NEIGHBOR_SHOW)) {
    const chip = document.createElement("span");
    chip.className = `neighbor-chip ${a.att}`;
    chip.textContent = `${ATT_ICON[a.att]} ${a.name}`;
    const r = Math.round(a.ratio * 10) / 10;
    const word = playT(lang, a.ratio >= ATT_HOSTILE_RATIO ? "factStronger" : a.ratio <= 0.85 ? "factWeaker" : "factEven");
    const lines = [
      playT(lang, a.att === "friendly" ? "attFriendly" : a.att === "hostile" ? "attHostile" : "attWary"),
      playT(lang, "factBorder").replace("{n}", String(a.borderEdges)),
      `${playT(lang, "factRatio").replace("{r}", String(r))} (${word})`,
      a.truceLeft > 0 ? playT(lang, "factTruce").replace("{n}", String(a.truceLeft)) : playT(lang, "factNoTruce"),
    ];
    if (a.hegemon) lines.push(playT(lang, "factHegemon"));
    chip.title = lines.join("\n");
    row.appendChild(chip);
  }
  if (atts.length > NEIGHBOR_SHOW) {
    const more = document.createElement("span");
    more.className = "neighbor-more";
    more.textContent = playT(lang, "moreNeighbors").replace("{n}", String(atts.length - NEIGHBOR_SHOW));
    row.appendChild(more);
  }
  panel.appendChild(row);
}
```

(c) In `renderActions`, replace the peace-option loop body (currently `for (const h of hostileNeighbors(s)) {...}`) with:

```ts
for (const a of neighborAttitudes(s)) { // same polities, sorted by border pressure, icon-prefixed
  const opt = document.createElement("option");
  opt.value = String(a.id);
  opt.textContent = `${ATT_ICON[a.att]} ${a.name}${a.truceLeft > 0 ? " ✓" : ""}`;
  pce.appendChild(opt);
}
```

Then check whether `hostileNeighbors` still has call sites in playApp.ts — if not, REMOVE it from the import (noUnusedLocals breaks the build otherwise).

(d) `src/theme.css`:

```css
/* neighbor attitude chips */
.neighbors { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
.neighbor-chip { font-size: 11.5px; padding: 1px 7px; border-radius: 9px; border: 1px solid #c9bb96; background: #f2ead6; cursor: default; }
.neighbor-chip.friendly { border-color: #4a8c5a; }
.neighbor-chip.wary { border-color: #b08a2e; }
.neighbor-chip.hostile { border-color: #a63d36; color: #7c2f28; }
.neighbor-more { font-size: 11px; color: #8a7a5e; align-self: center; }
```

- [ ] **Step 4: Run the playApp suite + full suite + typecheck**

Run: `npx vitest run src/ui/playApp.test.ts`, `npx vitest run`, `npx tsc --noEmit` — all green.

- [ ] **Step 5: Commit**

```bash
git add src/ui/playApp.ts src/ui/i18n.ts src/theme.css src/ui/playApp.test.ts
git commit -m "feat(play): neighbor attitude chips with itemized reason tooltips; peace select carries attitudes"
```

---

### Task 5: Full verification (controller-run)

- [ ] **Step 1:** `npx vitest run` from the worktree root — all green (~450 expected; trust actual counts). `npm run build` clean.
- [ ] **Step 2:** Live via dev server + javascript eval on `/play.html`: chips render with tooltips; peace options icon-prefixed; play a run to the end programmatically, return to the picker → `.legacy-panel` with an epitaph row; reload the page → annals persist; KO/EN toggle localizes the panel and chips; no console errors.
- [ ] **Step 3:** Whole-branch final review (most capable model, read-only git), one fix wave if needed, then merge per finishing-a-development-branch; remind the user push awaits "push해" and the visual look needs their eyes.
