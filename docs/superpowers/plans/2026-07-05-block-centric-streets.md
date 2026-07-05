# Block-Centric Streets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make city-drilldown roads and buildings coherent by construction: streets become the gaps between Voronoi ward blocks (Watabou-style block-centric), buildings are lots inset within each block fronting those streets, and the tensor-field streamline roads are removed.

**Architecture:** New pure module `blockStreets.ts` extracts the street network from shared ward edges and classifies main vs minor via gate→centre Dijkstra. `generateCityLayout` is reordered to generate wards first, derive gates from the street graph via the existing `wallFromDefenses`, then set `mainRoads`/`minorRoads` (interface unchanged — only their content changes). Buildings subdivide inset wards. The tensor-field/streamline modules are deleted.

**Tech Stack:** TypeScript, Vitest, d3-delaunay (already used by wards), SVG via `svgEl`.

**Spec:** `docs/superpowers/specs/2026-07-05-block-centric-streets-design.md`

## Global Constraints

- Engine (`src/engine/**`) pure/DOM-free; determinism per-run (same rng + inputs → identical output).
- Byte-compat with prior city layouts WAIVED (every layout changes — redesign). World map/history untouched (separate rng stream, golden hash safe) — do NOT touch `world.ts`/`history.ts`.
- `CityLayout.mainRoads`/`minorRoads` stay `Polyline[]` — only their content changes (ward-edge streets, not streamlines). All downstream consumers (renderer, zoning, castle, harbor, countryside, detail glyphs, moat, suburb roads, `waterBridges`) keep working.
- Streets = interior shared ward edges. Buildings = `subdivide(insetPolygon(ward.polygon, 2.5), { minArea, margin: 0.5 })`. Remove the `nearRoad` building filter. Keep water filter + `pointInPolygon(boundary)`.
- Minor street segments whose midpoint is in water are dropped; main crossings kept (bridged by `waterBridges`).
- Every gate gets a main road reaching it (classifyStreets gate→node stub; connectivity fallback when Dijkstra finds no path).
- Streamline-era `trimEndsToInset` + 14px `gateConnectors` + the "no street dead-ends on blank wall" test are REMOVED (superseded). The "genuinely curved main road" test is REMOVED (block streets are straight by design).
- Tests: Vitest. Focused per task; full `npm test`; build `npm run build`. Commit style: Korean feat/fix + footer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: `blockStreets.ts` — extract the street graph from shared ward edges

**Files:**
- Create: `src/engine/city/blockStreets.ts`
- Test: `src/engine/city/blockStreets.test.ts`

**Interfaces:**
- Consumes: `WardCell` (`{ polygon: Polygon; site: Point }`) from `./wards`; `Point`/`Polygon`/`Polyline` from `../geometry`.
- Produces: `StreetGraph { nodes: Point[]; edges: [number, number][]; segments: Polyline[] }` and `extractStreets(wards: WardCell[]): StreetGraph`.

- [ ] **Step 1: Write the failing test** — `src/engine/city/blockStreets.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { extractStreets } from "./blockStreets";
import type { WardCell } from "./wards";

const ward = (poly: [number, number][], site: [number, number]): WardCell => ({ polygon: poly, site });

describe("extractStreets", () => {
  it("returns only edges shared by two wards (interior streets), deduping nodes", () => {
    const w1 = ward([[0, 0], [10, 0], [10, 10], [0, 10]], [5, 5]);
    const w2 = ward([[10, 0], [20, 0], [20, 10], [10, 10]], [15, 5]);
    const far = ward([[40, 40], [50, 40], [50, 50], [40, 50]], [45, 45]);
    const g = extractStreets([w1, w2, far]);
    expect(g.segments.length).toBe(1); // only the shared x=10 edge
    expect(g.nodes.length).toBe(2);    // its two endpoints, deduped
    expect(g.edges.length).toBe(1);
    const s = g.segments[0];
    expect(s.every((p) => Math.abs(p[0] - 10) < 0.01)).toBe(true);
  });
  it("returns no streets when no wards are adjacent", () => {
    const a = ward([[0, 0], [10, 0], [10, 10], [0, 10]], [5, 5]);
    const b = ward([[40, 40], [50, 40], [50, 50], [40, 50]], [45, 45]);
    expect(extractStreets([a, b]).segments.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run src/engine/city/blockStreets.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** — `src/engine/city/blockStreets.ts`:

```ts
// Block-centric streets (Watabou-style): the city is partitioned into ward blocks and the
// streets are the gaps between them — i.e. the edges shared by two adjacent wards.
import type { Point, Polyline } from "../geometry";
import type { WardCell } from "./wards";

export interface StreetGraph {
  nodes: Point[];
  edges: [number, number][];
  segments: Polyline[];
}

const KEY = (p: Point) => `${Math.round(p[0] * 4)},${Math.round(p[1] * 4)}`; // 0.25px snap grid

// an edge shared by exactly two ward polygons is an interior street; an edge on the city
// perimeter belongs to one ward (the wall side) and is not a street.
export function extractStreets(wards: WardCell[]): StreetGraph {
  const seen = new Map<string, { a: Point; b: Point; n: number }>();
  for (const w of wards) {
    const poly = w.polygon;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const ka = KEY(a), kb = KEY(b);
      if (ka === kb) continue;
      const key = ka < kb ? ka + "|" + kb : kb + "|" + ka;
      const rec = seen.get(key);
      if (rec) rec.n++;
      else seen.set(key, { a, b, n: 1 });
    }
  }
  const nodeIndex = new Map<string, number>();
  const nodes: Point[] = [];
  const nodeOf = (p: Point) => {
    const k = KEY(p);
    let idx = nodeIndex.get(k);
    if (idx === undefined) { idx = nodes.length; nodeIndex.set(k, idx); nodes.push(p); }
    return idx;
  };
  const edges: [number, number][] = [];
  const segments: Polyline[] = [];
  for (const { a, b, n } of seen.values()) {
    if (n !== 2) continue;
    const ia = nodeOf(a), ib = nodeOf(b);
    if (ia !== ib) { edges.push([ia, ib]); segments.push([a, b]); }
  }
  return { nodes, edges, segments };
}
```

- [ ] **Step 4: Run** — `npx vitest run src/engine/city/blockStreets.test.ts` PASS; `npm run build` clean.

- [ ] **Step 5: Commit** — `git commit -am "feat: blockStreets — ward 공유 모서리에서 도로 그래프 추출 (블록 중심)"`

---

### Task 2: `blockStreets.ts` — classify main/minor via gate→centre Dijkstra

**Files:**
- Modify: `src/engine/city/blockStreets.ts`
- Test: `src/engine/city/blockStreets.test.ts`

**Interfaces:**
- Consumes: `StreetGraph` from Task 1.
- Produces: `classifyStreets(graph: StreetGraph, gates: Point[], centre: Point): { main: Polyline[]; minor: Polyline[] }`. `main` includes a `[gate, nearestNode]` stub per gate (guarantees every gate joins the network); on a disconnected graph it also emits a `[nearestNode, centre]` fallback stub.

- [ ] **Step 1: Failing test** — append to `blockStreets.test.ts`:

```ts
import { classifyStreets } from "./blockStreets";

describe("classifyStreets", () => {
  it("marks a gate→centre path as main and connects the gate", () => {
    // a 1D chain of 3 collinear blocks → nodes at x=0,10,20,30 (y 0..10), streets at x=10,20
    const w = (x: number): WardCell => ({ polygon: [[x, 0], [x + 10, 0], [x + 10, 10], [x, 10]], site: [x + 5, 5] });
    const g = extractStreets([w(0), w(10), w(20)]);
    const { main, minor } = classifyStreets(g, [[0, 5]], [25, 5]);
    // gate at x=0 → centre near x=25: both interior streets (x=10, x=20) are on the path → main
    expect(main.length).toBeGreaterThanOrEqual(2);
    // a stub connects the gate (x=0) to the network
    expect(main.some((s) => s.some((p) => Math.abs(p[0]) < 0.01 && Math.abs(p[1] - 5) < 0.01))).toBe(true);
    expect(minor.length).toBe(0);
  });
  it("emits a fallback stub when the graph has no gate→centre path", () => {
    const g = { nodes: [[0, 0], [1, 0]] as [number, number][], edges: [] as [number, number][], segments: [] as [number, number][][] };
    const { main } = classifyStreets(g, [[0, 0]], [100, 100]);
    expect(main.length).toBeGreaterThanOrEqual(1); // gate still joined via stub(s)
  });
});
```

- [ ] **Step 2: Run** — FAIL (`classifyStreets` missing).

- [ ] **Step 3: Implement** — append to `blockStreets.ts`:

```ts
export function classifyStreets(
  graph: StreetGraph, gates: Point[], centre: Point,
): { main: Polyline[]; minor: Polyline[] } {
  const { nodes, edges } = graph;
  if (nodes.length === 0) return { main: [], minor: [] };
  const nearestNode = (p: Point) => {
    let bi = 0, bd = Infinity;
    for (let i = 0; i < nodes.length; i++) {
      const d = (nodes[i][0] - p[0]) ** 2 + (nodes[i][1] - p[1]) ** 2;
      if (d < bd) { bd = d; bi = i; }
    }
    return bi;
  };
  const adj: { to: number; edge: number }[][] = nodes.map(() => []);
  edges.forEach(([a, b], ei) => { adj[a].push({ to: b, edge: ei }); adj[b].push({ to: a, edge: ei }); });
  const wlen = (ei: number) => { const [a, b] = edges[ei]; return Math.hypot(nodes[a][0] - nodes[b][0], nodes[a][1] - nodes[b][1]); };
  const centreNode = nearestNode(centre);
  const mainEdge = new Set<number>();
  const stubs: Polyline[] = [];
  for (const gate of gates) {
    const start = nearestNode(gate);
    stubs.push([gate, nodes[start]]);                 // always connect the gate to the network
    const dist = new Array(nodes.length).fill(Infinity);
    const prevEdge = new Array(nodes.length).fill(-1);
    const prevNode = new Array(nodes.length).fill(-1);
    const done = new Array(nodes.length).fill(false);
    dist[start] = 0;
    for (let it = 0; it < nodes.length; it++) {
      let u = -1, bd = Infinity;
      for (let i = 0; i < nodes.length; i++) if (!done[i] && dist[i] < bd) { bd = dist[i]; u = i; }
      if (u === -1 || u === centreNode) break;
      done[u] = true;
      for (const { to, edge } of adj[u]) {
        const nd = dist[u] + wlen(edge);
        if (nd < dist[to]) { dist[to] = nd; prevEdge[to] = edge; prevNode[to] = u; }
      }
    }
    if (dist[centreNode] < Infinity && centreNode !== start) {
      let cur = centreNode;
      while (cur !== start && prevEdge[cur] !== -1) { mainEdge.add(prevEdge[cur]); cur = prevNode[cur]; }
    } else if (centreNode !== start) {
      stubs.push([nodes[start], centre]);             // fallback: disconnected graph
    }
  }
  const main: Polyline[] = [];
  const minor: Polyline[] = [];
  edges.forEach(([a, b], ei) => {
    const seg: Polyline = [nodes[a], nodes[b]];
    if (mainEdge.has(ei)) main.push(seg); else minor.push(seg);
  });
  return { main: [...main, ...stubs], minor };
}
```

- [ ] **Step 4: Run** — `npx vitest run src/engine/city/blockStreets.test.ts` all PASS; `npm run build` clean.

- [ ] **Step 5: Commit** — `git commit -am "feat: blockStreets — 성문→중심 Dijkstra로 큰길/골목 분류 + 연결 폴백"`

---

### Task 3: Wire block streets into `generateCityLayout` (the reorder)

**Files:**
- Modify: `src/engine/city.ts`
- Test: `src/engine/city.test.ts`

**Interfaces:**
- Consumes: `extractStreets`, `classifyStreets` (Tasks 1-2); existing `generateWards`, `wallFromDefenses`, `assignZones`, `subdivide`, `insetPolygon`, `inWater`, `waterBridges`.
- Produces: `mainRoads`/`minorRoads` populated from block streets; wall gates from street nodes; buildings from inset wards. `CityLayout` shape unchanged.

This is the atomic surgery of `generateCityLayout`. Do all edits, then run.

- [ ] **Step 1: Failing test** — in `src/engine/city.test.ts`, add:

```ts
describe("block-centric streets", () => {
  const segMid = (s: [number, number][]) => [(s[0][0] + s[1][0]) / 2, (s[0][1] + s[1][1]) / 2] as [number, number];
  it("streets are ward edges, gates connect to a main road, and buildings never sit on a street", () => {
    for (const s of [1, 5, 9]) {
      const l = generateCityLayout({ id: 7, name: "T", size: 4, coastal: false, isCapital: false, elevation: 0.4, biome: GRASSLAND }, s);
      // every gate has a main-road point on it (stub start)
      for (const g of l.wall!.gates) {
        expect(l.mainRoads.some((r) => r.some((p) => Math.hypot(p[0] - g[0], p[1] - g[1]) < 1))).toBe(true);
      }
      // no building centroid sits on a minor street midpoint's block gap (sample: no minor street
      // midpoint falls inside any building polygon — the inset guarantees the gap)
      const buildings = l.wards.flatMap((w) => w.buildings);
      for (const st of l.minorRoads) {
        const m = segMid(st as [number, number][]);
        expect(buildings.some((b) => pointInPolygon(m, b))).toBe(false);
      }
      // no MINOR street runs through water
      for (const st of l.minorRoads) expect(inWater(l.water, segMid(st as [number, number][]))).toBe(false);
    }
  });
  it("is deterministic", () => {
    const ctx = { id: 3, name: "T", size: 4, coastal: true, isCapital: false, elevation: 0.4, biome: GRASSLAND };
    expect(JSON.stringify(generateCityLayout(ctx, 4))).toBe(JSON.stringify(generateCityLayout(ctx, 4)));
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run src/engine/city.test.ts -t "block-centric"` → FAIL.

- [ ] **Step 3: Implement the surgery** in `src/engine/city.ts`:

(a) **Imports:** add `import { extractStreets, classifyStreets } from "./city/blockStreets";`. Remove `import { makeTensorField } from "./city/tensorField";`, `import type { BasisField, Vec } from "./city/tensorField";`, and `import { generateStreets } from "./city/streets";`.

(b) **Replace `Vec` with `Point`:** change `const center: Vec = [230, 230];` to `const center: Point = [230, 230];`. Delete the `fieldsFor(...)` function entirely.

(c) **Replace the street/wall region.** Find the block that starts at `const noiseAmp =` and runs through the `gateBridges` definition, and the later `const allRoads = [...mainRoads, ...minorRoads];` + `trimEndsToInset`/`gateConnectors` block. Replace the WHOLE streamline pipeline with block-centric generation. The new order (wards → streets → gates → classify) means wards move UP. Concretely:

Remove: the `noiseAmp`/`makeTensorField`/`field`/`insideRegion`/`stop`/`seedCandidates`/`drySeeds`/`seeds`/`generateStreets`(×2)/`waterBridges` lines, the `trimEndsToInset`+`gateConnectors` block, and the `trimEndsToInset` helper function near the top (no longer used). Keep `moat` and `gateBridges` (they depend on `wall`).

Insert this pipeline (after `boundary`/`mountains` are built, replacing the streamline section):

```ts
  // BLOCK-CENTRIC: wards are the city blocks; streets are the gaps (shared ward edges).
  let wardCells = generateWards(rng, center[0], center[1], radius * 1.15, 8 + ctx.size * 3);
  wardCells = wardCells.filter((c) => pointInPolygon(c.site, boundary) && !inWater(water, c.site));
  const streetGraph = extractStreets(wardCells);

  const maxGates = 2 + Math.floor(ctx.size / 3);
  // gates sit where streets reach the wall: feed the street nodes as candidate road-ends
  const wall = wallFromDefenses(boundary, water, mountains, streetGraph.nodes.map((nd) => [nd, nd]), maxGates);

  const classified = classifyStreets(streetGraph, wall.gates, [center[0], center[1]]);
  // drop MINOR streets that run through water (buildings avoid water so those blocks are empty);
  // main streets/stubs are kept and bridged where they cross water
  let mainRoads = classified.main;
  let minorRoads = classified.minor.filter((s) => !inWater(water, [(s[0][0] + s[1][0]) / 2, (s[0][1] + s[1][1]) / 2]));
  water.bridges = waterBridges([...mainRoads, ...minorRoads], water);

  const moat = MOAT_ARCHETYPES.has(archetype.id)
    ? wall.segments.map((s) => offsetSegment(s, center, 6).map((o, i) => (inWater(water, o) ? s[i] : o)))
    : null;
  const gateBridges: Polyline[] = moat
    ? wall.gates
        .map((g): Polyline | null => {
          const dx = g[0] - center[0], dy = g[1] - center[1];
          const L = Math.hypot(dx, dy) || 1;
          const ux = dx / L, uy = dy / L;
          const outer: Point = [g[0] + ux * 11, g[1] + uy * 11];
          if (inWater(water, outer)) return null;
          return [[g[0] - ux * 3, g[1] - uy * 3], outer];
        })
        .filter((b): b is Polyline => b !== null)
    : [];
```

(d) **Wards for zoning/buildings now reuse `wardCells`.** Find the later `let cells = generateWards(rng, ...)` line and replace it with `let cells = wardCells;` (do NOT call generateWards again — the wards are already generated and filtered above; regenerating would consume rng differently and duplicate work). Everything from `castleAnchor`/`seaAnchor`/`assignZones` onward stays.

(e) **Buildings from inset wards + drop `nearRoad`.** In the ward→buildings map, change the subdivide call and filter. Find:
```ts
      buildings = subdivide(rng, z.polygon, { minArea: DENSITY[z.type] ?? 130, margin: 1.5 });
      buildings = buildings.filter((b) => {
        const c = centroid(b);
        const dryOk = archetype.onStilts || !inWater(water, c);
        return pointInPolygon(c, boundary) && dryOk && !nearRoad(c);
      });
```
Replace with:
```ts
      buildings = subdivide(rng, insetPolygon(z.polygon, 2.5), { minArea: DENSITY[z.type] ?? 130, margin: 0.5 });
      buildings = buildings.filter((b) => {
        const c = centroid(b);
        const dryOk = archetype.onStilts || !inWater(water, c);
        return pointInPolygon(c, boundary) && dryOk;
      });
```
Also delete the now-unused `allRoads`/`nearRoad` definitions.

(f) `mainRoads`/`minorRoads` are already `let` and returned in the `CityLayout` object — no return change needed.

- [ ] **Step 4: Run** — `npx vitest run src/engine/city.test.ts` → the new tests PASS. Some EXISTING city tests will break and must be updated to the new paradigm:
  - REMOVE the test `"has at least one genuinely curved main road across seeds"` (streets are straight now).
  - REMOVE the `describe("roads respect the wall and gates", ...)` block added by the prior streamline fix (the "no street dead-ends on blank wall" assertion no longer applies; gate connectivity is covered by the new block-centric test).
  - Fix any assertion referencing removed helpers. Then `npm test` full; `npm run build`. (tensorField/streets files still exist — deleted in Task 4; leaving them is fine here as long as nothing imports them from city.ts anymore. If tsc flags the now-unused files, that's Task 4.)

- [ ] **Step 5: Commit** — `git commit -am "feat: 도시 도로를 블록 중심으로 — ward 먼저→도로=블록 틈→성문→건물 인셋 (스트림라인 제거)"`

---

### Task 4: Delete the tensor-field / streamline modules

**Files:**
- Delete: `src/engine/city/tensorField.ts`, `src/engine/city/tensorField.test.ts`, `src/engine/city/streets.ts`, `src/engine/city/streets.test.ts`
- Test: full suite + build

**Interfaces:** none produced; removes dead code.

- [ ] **Step 1: Confirm no importers** — run `rg -n "tensorField|from \"\\./streets\"|from \"\\./city/streets\"|makeTensorField|generateStreets|BasisField" src` (Grep). Expect matches ONLY inside the four files to be deleted (and possibly a stale comment). If anything else imports them, STOP and report.

- [ ] **Step 2: Delete the four files.**

```bash
git rm src/engine/city/tensorField.ts src/engine/city/tensorField.test.ts src/engine/city/streets.ts src/engine/city/streets.test.ts
```

- [ ] **Step 3: Build + full suite** — `npm run build` clean (no dangling imports / no `Vec`/`BasisField` references remain); `npm test` all green.

- [ ] **Step 4: Commit** — `git commit -m "chore: 텐서필드·스트림라인 도로 모듈 제거 (블록 중심으로 대체)" + footer`

---

### Task 5: Integration verify + deploy

**Files:** none new (fixes only if verification finds issues)

- [ ] **Step 1: Full suite + build** — `npm test` green; `npm run build` clean.
- [ ] **Step 2: Live DOM verify** — dev server (`worldmaker` launch config), `preview_resize({width:1280,height:800})` first (screenshot times out — use eval/inspect). Open `map.html`, sweep ~6 cities via `preview_eval`. Assert: (a) every `.road-main`/`.road-minor` segment's endpoints coincide (within ~0.5px) with a ward-boundary vertex — i.e. streets ARE ward edges; (b) no `.building` polygon contains a minor-street midpoint (buildings off streets); (c) every gate has a main road point on it; (d) roads render after buildings (z-order) and read clearly; (e) a coastal/river city has no minor street mid-water. Report counts.
- [ ] **Step 3: Visual gut-check with the user** — the screenshot harness is broken, so this is the subjective call: does the block-and-street grid read like a coherent medieval town (vs the old misaligned overlay)? If wall-adjacent streets read poorly, note the pomerium-trim follow-up from the spec.
- [ ] **Step 4: Merge + deploy** — merge branch to `main` in the parent repo (`git -C /c/projects/WorldMaker merge --no-ff …`), push (Pages auto-deploys; if deploy-pages fails "try again later", wait ~5 min and push an empty commit — known Pages throttle). Verify the live JS bundle still serves and a city renders.
- [ ] **Step 5: Ask the user to eyeball** the deployed site — roads/buildings alignment is the whole point; confirm it looks right or iterate ("그래도 이상하면 바꿔보고").

---

## Self-Review Notes

- Spec coverage: §1 paradigm→Task 3; §2 extractStreets→Task 1; §2 classifyStreets + §2a water-drop + §2b fallback→Task 2 (classify/fallback) + Task 3 (minor water-drop wiring); §3 gates via wallFromDefenses→Task 3; §4 buildings inset + margin 0.5 + drop nearRoad→Task 3; §5 rendering unchanged (no task needed — interface preserved); §6 consumers preserved (verified by keeping the existing tests green in Tasks 3-5); §7 cleanup→Task 4; §8 tests→Tasks 1-3 + removals in Task 3.
- Deviations from spec, all reconciled in the spec text: prior streamline-era trim/deadEnd test REMOVED (spec §8 updated); curved-road test REMOVED (spec §8).
- Type consistency: `StreetGraph`/`extractStreets`/`classifyStreets` signatures identical across Tasks 1-3; `wardCells: WardCell[]` reused for both streets and zoning; `mainRoads`/`minorRoads` remain `Polyline[]`.
- Determinism: wards + subdivide use rng (unchanged draw structure aside from removing tensor draws); extractStreets/classifyStreets are rng-free. World stream untouched.
- Risk: block granularity (ward count `8+size*3`) and wall-adjacent street look are the two verification-driven unknowns (Task 5) — both have named follow-ups, neither blocks the interface.
