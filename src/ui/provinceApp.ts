import { generateWorld } from "../engine/world";
import { DEFAULT_PARAMS, type World } from "../types/world";
import {
  initProvinceSim, pAggregate, PROVINCE_SIM_TICKS, armableTargets, stepPlayerTurn, explainAttack,
  offerProvinceDilemma, resolveProvinceDilemma, defectionRisk,
  type ProvinceSimState, type AttackReason, type ProvinceDilemma, type DefectionReason,
} from "../engine/provinceSim";
import { politicalLayer } from "./politicalLayer";
import { politicalBorders, sharedEdge, type Segment } from "../engine/borders";
import { segPath, cellPath } from "./svgPaths";
import { PLAYER_COLOR } from "./nationPalette";
import { svgEl } from "./renderer";
import { detectLang } from "./lang";

// per-cell owner = the owner of the cell's province (ocean/unowned → -1). Feeding this to politicalLayer
// paints whole provinces in their nation's colour (the EU4 whole-province model) and yields data-polity paths.
export function provinceCellOwner(count: number, provinceOf: ArrayLike<number>, provOwner: Int32Array): Int32Array {
  const out = new Int32Array(count).fill(-1);
  for (let c = 0; c < count; c++) { const p = provinceOf[c]; if (p >= 0) out[c] = provOwner[p]; }
  return out;
}

interface UI { world: ReturnType<typeof generateWorld>["world"]; s: ProvinceSimState; playerId: number; startProvinces: number; }

// Domination = you have CONQUERED 15% of the map beyond where you started. Additive (not ×start)
// so it is start-fair: a tiny realm and a large one must both take the same absolute number of provinces, a big
// start never wins instantly (gain is 0 at t0), and a small start can't win by grabbing 2 neighbours. Lowered
// from 0.2 after measurement: province defection makes holding conquered land harder, so net expansion is
// harder and 0.2 was nearly unreachable under headless policies. SP3-tunable.
const DOMINATION_GAIN_FRAC = 0.15;
const CONSOLIDATE_MAX = 2; // a consolidate turn can shore up at most this many provinces — you can't shield everything
export function isDomination(prov: number, start: number, land: number): boolean {
  return prov - start >= Math.round(DOMINATION_GAIN_FRAC * land);
}

// how strongly to wash a province toward parchment given its solidarity: stable land (≳0.55) stays full
// colour, fragile land fades pale so the player SEES where their realm (and the enemy's) is shaky. Tunable.
export function shakyOpacity(sol: number): number {
  const op = (0.55 - sol) * 1.2;
  return op < 0 ? 0 : op > 0.5 ? 0.5 : op;
}

// surviving to the horizon is not a flat "win" — it is GRADED by how much you grew, so turtling in place reads
// as an unremarkable "merely endured" while real expansion is celebrated (research: anti-turtle = win-condition).
export function survivalGrade(prov: number, start: number, land: number): "great" | "grown" | "held" {
  const gain = prov - start;
  if (gain >= Math.round(0.1 * land)) return "great"; // grew by ~a tenth of the map
  if (gain > 0) return "grown";
  return "held";                                        // stood still or shrank — the turtle outcome
}

// plain-language reason an attack wins/loses, for the battle preview + tooltips.
export function reasonText(reason: AttackReason, lang: "ko" | "en"): string {
  const ko: Record<AttackReason, string> = {
    "realm-strong": "내 나라가 강함", "realm-weak": "내 나라가 불안정함",
    "target-shaky": "그 지역이 흔들림", "target-stable": "그 지역이 굳건함",
    "near": "수도에서 가까움", "too-far": "수도에서 멀어 원정 페널티", "even": "막상막하",
  };
  const en: Record<AttackReason, string> = {
    "realm-strong": "your realm is strong", "realm-weak": "your realm is unstable",
    "target-shaky": "the province is shaky", "target-stable": "the province is well-held",
    "near": "close to your capital", "too-far": "far from your capital", "even": "an even match",
  };
  return (lang === "ko" ? ko : en)[reason];
}

// risk-panel ordering: most-urgent (fewest turns left) first, ties broken by province id — so a province
// flipping NEXT TURN is never buried below one with turns to spare. Pure + exported so it's directly testable.
export function sortRisksByUrgency<T extends { p: number; r: { turnsLeft: number } }>(risks: T[]): T[] {
  return [...risks].sort((a, b) => a.r.turnsLeft - b.r.turnsLeft || a.p - b.p);
}

// a defection warning always says WHY, the same contract explainAttack follows for attacks.
export function defectionReasonText(reason: DefectionReason, ownN: number, foeN: number, lang: "ko" | "en"): string {
  if (lang === "ko") {
    return reason === "isolated" ? `고립됨 (적 이웃 ${foeN} · 내 이웃 ${ownN})`
      : reason === "far" ? "수도에서 너무 멂"
      : "수비가 약함";
  }
  return reason === "isolated" ? `isolated (${foeN} hostile vs ${ownN} friendly)`
    : reason === "far" ? "too far from your capital"
    : "its garrison is thin";
}

// The map is a fixed 1000x700 viewBox fitted to its container, so anything drawn in viewBox units shrinks
// with the map: at ~360px phone width an r=9 badge would land at ~3 screen px. Counter-scale the badge so it
// keeps a roughly constant ON-SCREEN size. Capped at 2 — a constant-size badge and a shrinking province pull
// opposite ways, and on a phone a province is only ~24px across, so an uncapped badge would swallow it.
// Returns 1 when the width is unknown (jsdom, or before first layout).
export function badgeScale(mapWidthWorld: number, renderedWidthPx: number): number {
  if (!renderedWidthPx || renderedWidthPx <= 0) return 1;
  const k = mapWidthWorld / renderedWidthPx;
  return k < 1 ? 1 : k > 2 ? 2 : k;
}

// the badge's own diameter in viewBox units at scale 1 (r=9), used to size the PER-PROVINCE cap below.
export const BADGE_DIAMETER = 18;

// the smaller of a province's bounding-box width/height, in fixed viewBox units (constant regardless of
// screen size — only the CSS scale that fits the map into its container changes with the viewport). Used to
// cap the ✓ badge PER PROVINCE, so a global counter-scale can never make the badge bigger than the land it
// marks. 0 for a province with no cells (defensive; every real province owns at least one).
export function provinceSpan(world: World, provId: number): number {
  const grid = world.grid;
  const po = world.provinceOf;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let found = false;
  for (let c = 0; c < grid.count; c++) {
    if (po[c] !== provId) continue;
    found = true;
    for (const [x, y] of grid.polygons[c]) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  if (!found) return 0;
  return Math.min(maxX - minX, maxY - minY);
}

// clean OUTLINE of a whole province (its boundary against other provinces + ocean), not the jagged
// per-cell mesh — so a highlight reads as a province, not a pile of cells. Pure + exported so the
// ping's geometry is directly testable.
export function provinceOutlinePath(world: World, provId: number): string {
  const grid = world.grid;
  const po = world.provinceOf;
  const segs: Segment[] = [];
  for (let i = 0; i < grid.count; i++) {
    if (po[i] !== provId) continue;
    for (const j of grid.neighbors[i]) {
      if (po[j] === provId) continue; // internal cell edge — skip
      const e = sharedEdge(grid.polygons[i], grid.polygons[j]);
      if (e) segs.push(e);
    }
  }
  return segPath(segs);
}

// one province app lives on the page at a time (picker → play → "New world" all reuse the same root),
// but mountProvinceApp itself is re-invoked on every "New world" click — so the resize listener it
// registers must be de-duped at module scope, or each click leaks another permanent window listener
// closing over the discarded game's state. The disposer removes the listener AND clears whatever
// debounce timer it had pending — otherwise a resize fired just before a re-mount can fire its stale
// render() AFTER the new game mounts (a resize, then "New world" within the debounce delay), silently
// repainting the discarded world over the new one.
let disposeActiveResize: (() => void) | null = null;

export function mountProvinceApp(root: HTMLElement, opts: { seed?: number } = {}): void {
  const lang = detectLang();
  const seed = opts.seed ?? Math.floor(Date.now() % 1_000_000); // non-deterministic seed is fine — UI only
  const world = generateWorld({ ...DEFAULT_PARAMS, seed }).world;
  let ui: UI | null = null; // null = picker mode
  const targets = new Set<number>();
  // provinceSpan is constant for the life of the world (it only reads cell geometry, never sim state) but
  // walks all ~4000 cells per call — memoise per province id, lazily filled on first ask, so a render with N
  // winnable targets costs N cache hits instead of N full cell scans.
  const spanCache: number[] = [];
  function provinceSpanOf(provId: number): number {
    let v = spanCache[provId];
    if (v === undefined) { v = provinceSpan(world, provId); spanCache[provId] = v; }
    return v;
  }
  // a chronicle entry optionally carries the province it happened in, so the row can locate itself on the map
  type LogEntry = { text: string; prov?: number };
  const log: LogEntry[] = [];
  let mode: "conquer" | "consolidate" = "conquer"; // this turn: expand, or shore up my realm
  let pendingDilemma: ProvinceDilemma | null = null; // a choice card awaiting the player
  let lastDilemmaTick = -99;
  const DILEMMA_COOLDOWN = 4; // don't spam cards — min turns between offers

  function playerProvinceCount(u: UI): number {
    let k = 0; for (let p = 0; p < u.s.n; p++) if (u.s.provOwner[p] === u.playerId) k++; return k;
  }
  function totalLandProvinces(u: UI): number { return u.s.n; }
  function liveRivals(u: UI): number { return u.s.alive.filter((a, id) => a && id !== u.playerId).length; }

  // width of the rendered map in CSS pixels; 0 in jsdom (no layout) so badgeScale falls back to 1
  function mapWidthPx(): number {
    const el = root.querySelector(".prov-map");
    if (!el) return 0;
    try { return el.getBoundingClientRect().width; } catch { return 0; }
  }

  type Outcome = { kind: "defeat"; by: string } | { kind: "domination" } | { kind: "survival" } | null;
  function outcome(u: UI): Outcome {
    if (!u.s.alive[u.playerId]) {
      const cap = u.s.capitalProv[u.playerId];
      const by = u.world.polities[u.s.provOwner[cap]]?.name ?? "?";
      return { kind: "defeat", by };
    }
    if (isDomination(playerProvinceCount(u), u.startProvinces, u.s.n)) return { kind: "domination" };
    if (u.s.tick >= PROVINCE_SIM_TICKS) return { kind: "survival" };
    return null;
  }

  function buildMap(): SVGSVGElement {
    const s = ui ? ui.s : initProvinceSim(world); // picker previews the initial partition
    const owner = provinceCellOwner(world.grid.count, world.provinceOf, s.provOwner);
    const svg = svgEl("svg", {
      class: "prov-map", viewBox: `0 0 ${world.grid.width} ${world.grid.height}`, preserveAspectRatio: "xMidYMid meet",
    }) as SVGSVGElement;
    const layer = politicalLayer(
      world.grid, owner, world.polities,
      { fills: true, labels: true, legend: false, ...(ui ? { playerPolity: ui.playerId, playerColor: PLAYER_COLOR } : {}) },
    );
    svg.appendChild(layer);
    // solidarity wash: pale-out fragile provinces so stability is a THING YOU SEE on the map, not just a
    // HUD number. Play mode only (in the picker every province is a uniform 0.5). Under the borders/labels.
    if (ui) svg.appendChild(solidarityWash(ui));
    if (ui) svg.appendChild(seaLaneLayer(ui));
    // the province mesh: EVERY province boundary (incl. those inside one nation), so the map visibly
    // reads as "play in provinces" and not just nation blobs. Thin + faint UNDER the bold country lines.
    svg.appendChild(svgEl("path", {
      class: "province-border", d: segPath(politicalBorders(world.grid, world.provinceOf)),
      fill: "none", stroke: "#3c2f1c", "stroke-width": 0.5, "stroke-opacity": 0.5,
    }));
    // politicalLayer's own border path is unclassed as "nation-border" (that class belongs to
    // provinceLayer's owner overlay) — since `owner` here is already province-snapped, draw the same
    // bold country-outline overlay directly so every province view agrees on where a country ends.
    svg.appendChild(svgEl("path", {
      class: "nation-border", d: segPath(politicalBorders(world.grid, owner)),
      fill: "none", stroke: "#161009", "stroke-width": 2, "stroke-opacity": 0.95, "stroke-linejoin": "round",
    }));
    // politicalLayer nests its name labels INSIDE its own group, which we just painted the border meshes
    // on top of — so the province lines were crossing the text. Lift the label/marker groups to the end of
    // the svg so they paint ABOVE the borders and stay legible.
    for (const cls of [".free-city-markers", ".nation-labels"]) {
      const grp = layer.querySelector(cls);
      if (grp) svg.appendChild(grp); // appendChild MOVES the existing node to the top
    }
    return svg;
  }

  // ephemeral gold flash of a province OUTLINE on the CURRENT map svg — it answers "this name is WHICH
  // land?". No state, no re-render: a later render() rebuilds the svg and the ping is gone (transient by
  // design). pointer-events off so it can never block target/fortify clicks.
  function pingProvince(u: UI, provId: number): void {
    const svg = root.querySelector(".prov-map");
    if (!svg) return;
    const path = svgEl("path", {
      class: "prov-ping", style: "pointer-events:none", d: provinceOutlinePath(u.world, provId),
      fill: "none", stroke: "#e8b53a", "stroke-width": 3.4, "stroke-linejoin": "round",
    });
    path.addEventListener("animationend", () => path.remove());
    window.setTimeout(() => path.remove(), 1400); // fallback — jsdom fires no animation events
    svg.appendChild(path);
  }

  // mark a row that NAMES a province as click-to-locate. The cursor/underline/tooltip affordance is not
  // decoration: without it nothing tells the player the row can be clicked.
  function makePingable(el: HTMLElement, u: UI, provId: number): void {
    el.classList.add("prov-pingable");
    el.dataset.province = String(provId);
    el.title = lang === "ko" ? "지도에서 위치 보기" : "show on map";
    el.addEventListener("click", () => pingProvince(u, provId));
  }

  // the chronicle strip — the SAME one centred line as before (entries joined by " · "), except each entry
  // is its own span so a placed one can be clicked to locate it. Was copy-pasted in three render branches.
  function logEl(): HTMLElement {
    const el = document.createElement("div");
    el.className = "prov-log";
    log.slice(0, 8).forEach((e, i) => {
      if (i > 0) el.appendChild(document.createTextNode(" · "));
      const span = document.createElement("span");
      span.className = "prov-log-item";
      span.textContent = e.text;
      if (typeof e.prov === "number" && ui) makePingable(span, ui, e.prov);
      el.appendChild(span);
    });
    return el;
  }

  function startGame(playerId: number): void {
    const s = initProvinceSim(world);
    if (!s.alive[playerId]) return; // only live nations are playable
    const startProvinces = (() => { let k = 0; for (let p = 0; p < s.n; p++) if (s.provOwner[p] === playerId) k++; return k; })();
    ui = { world, s, playerId, startProvinces };
    targets.clear();
    log.length = 0;
    mode = "conquer";
    pendingDilemma = null;
    lastDilemmaTick = -99;
    render();
  }

  function solidarityWash(u: UI): SVGGElement {
    const byProv: string[] = u.world.provinces.map(() => "");
    for (let c = 0; c < u.world.grid.count; c++) {
      const p = u.world.provinceOf[c];
      if (p >= 0 && u.s.provOwner[p] >= 0) byProv[p] += cellPath(u.world.grid.polygons[c]);
    }
    const g = svgEl("g", { class: "prov-solidarity", style: "pointer-events:none" }) as SVGGElement;
    for (const prov of u.world.provinces) {
      if (!byProv[prov.id]) continue;
      const op = shakyOpacity(u.s.provSol[prov.id]);
      if (op <= 0.01) continue; // stable provinces show full colour
      g.appendChild(svgEl("path", {
        class: "prov-shaky", "data-province": prov.id, d: byProv[prov.id],
        fill: "#efe6cf", "fill-opacity": op.toFixed(2),
      }));
    }
    return g;
  }

  // provinces of yours that are slipping away — an amber dashed outline so you can SEE which land is at
  // risk, not just read about it. pointer-events off so it never blocks targeting.
  function defectionOverlay(u: UI): SVGGElement {
    const g = svgEl("g", { class: "prov-risks", style: "pointer-events:none" }) as SVGGElement;
    for (let p = 0; p < u.s.n; p++) {
      if (u.s.provOwner[p] !== u.playerId) continue;
      if (!defectionRisk(u.s, p)) continue;
      g.appendChild(svgEl("path", {
        class: "prov-risk-ring", d: provinceOutlinePath(u.world, p),
        fill: "none", stroke: "#d08a1e", "stroke-width": 2.4, "stroke-dasharray": "5 4", "stroke-linejoin": "round",
      }));
    }
    return g;
  }

  // expedition sea lanes: a dashed route between each linked province pair's centroids. Play mode only;
  // pointer-events off so it never blocks target clicks. Deduped by p < q.
  function seaLaneLayer(u: UI): SVGGElement {
    const g = svgEl("g", { class: "prov-lanes", style: "pointer-events:none" }) as SVGGElement;
    const laneAdj = u.s.laneAdj ?? [];
    for (let p = 0; p < laneAdj.length; p++) for (const q of laneAdj[p]) {
      if (q <= p) continue; // draw each undirected lane once
      const a = u.world.provinces[p].centroid, b = u.world.provinces[q].centroid;
      g.appendChild(svgEl("line", {
        class: "prov-lane", x1: a[0], y1: a[1], x2: b[0], y2: b[1],
        stroke: "#3f5d78", "stroke-width": 1.4, "stroke-dasharray": "6 5", "stroke-opacity": 0.55,
      }));
    }
    return g;
  }

  // one readable line for a target: "Name — ⚔ 72 vs 🛡 60 · you can take (the province is shaky)"
  function attackLine(u: UI, prov: number): string {
    const od = explainAttack(u.s, u.playerId, prov);
    const name = (od?.lane ? "⚓ " : "") + u.world.provinces[prov].name;
    if (!od) return u.world.provinces[prov].name;
    const verdict = od.win ? (lang === "ko" ? "점령 가능" : "you can take") : (lang === "ko" ? "실패" : "too strong");
    let line = `${name} — ⚔ ${Math.round(od.atk * 100)} ${lang === "ko" ? "대" : "vs"} 🛡 ${Math.round(od.def * 100)} · ${verdict} (${reasonText(od.reason, lang)})`;
    if (!od.win) line += od.breakable // a losing attack: does building up (consolidate) open it, or is it too tough for now?
      ? (lang === "ko" ? " · 🛡 내실하면 뚫림" : " · consolidate to break through")
      : (lang === "ko" ? " · 지금은 벅참 (상대가 약해지길)" : " · too tough for now (wait for it to weaken)");
    return line;
  }

  function targetOverlay(u: UI): SVGGElement {
    const arm = new Set(armableTargets(u.s, u.playerId));
    const byProv: string[] = u.world.provinces.map(() => "");
    for (let c = 0; c < u.world.grid.count; c++) {
      const p = u.world.provinceOf[c];
      if (p >= 0 && arm.has(p)) byProv[p] += cellPath(u.world.grid.polygons[c]);
    }
    const g = svgEl("g", { class: "prov-targets" }) as SVGGElement;
    // ONE pattern per rendered overlay (not per province). 45° so it never reads as another region
    // boundary — the borders here run mostly horizontal/vertical — and low contrast so ~100 small
    // provinces don't moiré. Pattern is the channel to use when hue is already taken.
    const defs = svgEl("defs");
    const hatch = svgEl("pattern", {
      id: "prov-hatch", width: 7, height: 7,
      patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)",
    });
    hatch.appendChild(svgEl("line", {
      x1: 0, y1: 0, x2: 0, y2: 7, stroke: "#3c2f1c", "stroke-width": 1.6, "stroke-opacity": 0.28,
    }));
    defs.appendChild(hatch);
    g.appendChild(defs);
    // both are the same for every province this render — a whole-map layout read plus a pure function of it —
    // so compute once outside the loop rather than once per winnable province.
    const badgeK = badgeScale(u.world.grid.width, mapWidthPx());
    for (const prov of u.world.provinces) {
      if (!byProv[prov.id]) continue;
      const armed = targets.has(prov.id);
      // colour every attackable province by the EXACT (deterministic) outcome: green = you would capture it,
      // red = the defender is too strong. The tooltip spells out the numbers + reason.
      const win = explainAttack(u.s, u.playerId, prov.id)?.win ?? false;
      const col = win ? "#2f8f4e" : "#b23a3a";
      // the tinted FILL is already province-shaped (a union of the cells); NO stroke here, so we don't draw the
      // internal cell mesh. It stays the clickable target.
      const path = svgEl("path", {
        class: "prov-target" + (armed ? " armed" : "") + (win ? " winnable" : " too-strong"),
        "data-province": prov.id, d: byProv[prov.id],
        fill: col, "fill-opacity": armed ? 0.4 : 0.16, stroke: "none",
      });
      const title = svgEl("title");
      title.textContent = attackLine(u, prov.id);
      path.appendChild(title);
      g.appendChild(path);
      // "Too strong" rides PATTERN: it scales with the province instead of sitting at a fixed footprint,
      // so it holds up on a small province and on a phone, where a glyph would not.
      if (!win) g.appendChild(svgEl("path", {
        class: "prov-hatch", style: "pointer-events:none",
        d: byProv[prov.id], fill: "url(#prov-hatch)",
      }));
      // armed provinces get a clean gold PROVINCE outline (not the cell mesh) to show the selection.
      if (armed) {
        g.appendChild(svgEl("path", {
          class: "prov-target-ring", style: "pointer-events:none", d: provinceOutlinePath(u.world, prov.id),
          fill: "none", stroke: "#e8b53a", "stroke-width": 2.2, "stroke-linejoin": "round",
        }));
      }
      // "You can take this" rides SHAPE, not hue — the fill hue already belongs to ownership, and the
      // green/red tint measures at 1.01-1.12 contrast against itself over varying nation colours.
      if (win) {
        const c = u.world.provinces[prov.id].centroid;
        // the global counter-scale keeps the badge a constant ON-SCREEN size, but on a small province that
        // can make the badge bigger than the land it marks (measured: at 370px map width badgeK hits its
        // cap of 2 while a real province there renders smaller than the disc). Cap the badge's DIAMETER to
        // ~70% of the province's own smaller extent — computed in fixed viewBox units, so it never grows
        // past the land regardless of viewport.
        const span = provinceSpanOf(prov.id);
        const fit = span > 0 ? (0.7 * span) / BADGE_DIAMETER : badgeK;
        // Floored at 1: the cap above is a pure downscale with no lower bound, and on a 1-2 cell province
        // (routine on coastal/leftover land) fit alone would shrink the badge to a near-invisible ~4px disc —
        // the ONLY non-colour cue for "you can take this" (hatching marks only the negative case). Never draw
        // the badge smaller than its authored size; on a tiny province it may overflow the province's own
        // borders instead, which is the correct trade (still centred on the right land, still legible).
        const k = Math.max(1, Math.min(badgeK, fit));
        const badge = svgEl("g", {
          class: "prov-verdict", style: "pointer-events:none", "data-province": prov.id,
          transform: `translate(${Math.round(c[0])},${Math.round(c[1])}) scale(${k.toFixed(2)})`,
        });
        badge.appendChild(svgEl("circle", {
          cx: 0, cy: 0, r: 9, fill: "#f4ecd8", stroke: "#3c2f1c", "stroke-width": 1.2,
        }));
        const mark = svgEl("text", {
          x: 0, y: 4.2, "text-anchor": "middle", "font-size": 12, "font-weight": 700, fill: "#1f6b3a",
        });
        mark.textContent = "✓";
        badge.appendChild(mark);
        g.appendChild(badge);
      }
    }
    return g;
  }

  // consolidate mode: your OWN provinces are clickable to shore up (capped). Selected ones get a blue ring;
  // the rest stay transparent-but-clickable so you can pick. The wash underneath still shows which are fragile.
  function fortifyOverlay(u: UI): SVGGElement {
    const byProv: string[] = u.world.provinces.map(() => "");
    for (let c = 0; c < u.world.grid.count; c++) {
      const p = u.world.provinceOf[c];
      if (p >= 0 && u.s.provOwner[p] === u.playerId) byProv[p] += cellPath(u.world.grid.polygons[c]);
    }
    const g = svgEl("g", { class: "prov-fortifies" }) as SVGGElement;
    for (const prov of u.world.provinces) {
      if (!byProv[prov.id]) continue;
      const sel = targets.has(prov.id);
      const path = svgEl("path", {
        class: "prov-fortify" + (sel ? " armed" : ""), "data-province": prov.id, d: byProv[prov.id],
        fill: sel ? "#3a6ea5" : "transparent", "fill-opacity": sel ? 0.34 : 0, stroke: "none",
      });
      const title = svgEl("title");
      title.textContent = `${prov.name} — ${lang === "ko" ? "안정도" : "stability"} ${Math.round(u.s.provSol[prov.id] * 100)}%`;
      path.appendChild(title);
      g.appendChild(path);
      if (sel) g.appendChild(svgEl("path", {
        class: "prov-fortify-ring", style: "pointer-events:none", d: provinceOutlinePath(u.world, prov.id),
        fill: "none", stroke: "#3a6ea5", "stroke-width": 2.2, "stroke-linejoin": "round",
      }));
    }
    return g;
  }

  function hudText(u: UI): string {
    const avg = Math.round(pAggregate(u.s)[u.playerId].avg * 100);
    const capOk = u.s.alive[u.playerId];
    const t = { ko: { prov: "영토", sol: "안정도", turn: "턴", cap: "수도", capOk: "유지", capLost: "상실", rivals: "라이벌" },
                en: { prov: "provinces", sol: "stability", turn: "turn", cap: "capital", capOk: "held", capLost: "lost", rivals: "rivals" } }[lang];
    return `${t.prov} ${playerProvinceCount(u)}/${totalLandProvinces(u)} · ${t.sol} ${avg}% · ${t.turn} ${u.s.tick}/${PROVINCE_SIM_TICKS} · ${t.cap} ${capOk ? t.capOk : t.capLost} · ${t.rivals} ${liveRivals(u)}`;
  }

  // a dilemma choice card — title, flavour, and two tradeoff options. Resolving applies the effect and continues.
  function dilemmaCard(u: UI, d: ProvinceDilemma): HTMLElement {
    const name = d.prov >= 0 ? u.world.provinces[d.prov].name : "";
    const T = {
      restless: { ko: [`🔥 동요하는 정복지 — ${name}`, "갓 정복한 땅이 동요합니다.", "주둔군 파견 (그 땅 안정 ↑, 수도 지침)", "방치 (그대로 둔다)"],
                  en: [`🔥 A restless conquest — ${name}`, "Your newly-taken land simmers.", "Garrison it (steady it; your capital tires)", "Let it be"] },
      defector: { ko: [`🏳 국경의 배신자 — ${name}`, "국경 영주가 귀순을 제안합니다.", "수락 (영토 획득, 불안정하게)", "거절"],
                  en: [`🏳 A border defector — ${name}`, "A border lord offers you fealty.", "Accept (gain the province, fragile)", "Refuse"] },
      muster: { ko: ["⚔ 소집령", "장군들이 소집을 청합니다.", "국경 징집 (국경 ↑, 내륙 ↓)", "휴식 (전 영토 소폭 ↑)"],
                en: ["⚔ The muster", "Your marshals call for a levy.", "Levy the frontier (border ↑, interior ↓)", "Rest (small gain everywhere)"] },
    }[d.code][lang];
    const card = document.createElement("div");
    card.className = "prov-dilemma";
    const h = document.createElement("div"); h.className = "prov-dilemma-title"; h.textContent = T[0];
    if (d.prov >= 0) makePingable(h, u, d.prov); // muster names no province — nothing to locate
    const body = document.createElement("div"); body.className = "prov-dilemma-body"; body.textContent = T[1];
    const bar = document.createElement("div"); bar.className = "prov-bar";
    for (const [choice, label] of [["a", T[2]], ["b", T[3]]] as const) {
      const b = document.createElement("button");
      b.className = "prov-choice"; b.dataset.choice = choice; b.textContent = label;
      b.addEventListener("click", () => {
        resolveProvinceDilemma(u.s, u.playerId, d, choice);
        log.unshift({
          text: `${lang === "ko" ? "결정" : "chose"}: ${(choice === "a" ? T[2] : T[3]).split(" (")[0]}`,
          ...(d.prov >= 0 ? { prov: d.prov } : {}),
        });
        pendingDilemma = null;
        render();
      });
      bar.appendChild(b);
    }
    card.append(h, body, bar);
    return card;
  }

  function buildHeader(): HTMLElement {
    const h = document.createElement("div");
    h.className = "prov-header";
    const home = document.createElement("a");
    home.className = "home";
    home.href = "index.html"; // relative — GitHub Pages sub-path safe
    home.textContent = lang === "ko" ? "🏠 홈" : "🏠 Home";
    const title = document.createElement("h1");
    title.className = "app-title prov-title";
    title.textContent = lang === "ko" ? "영토" : "Provinces";
    const hint = document.createElement("div");
    hint.className = "prov-hint";
    hint.textContent = ui
      ? (lang === "ko"
          ? `${ui.world.polities[ui.playerId]?.name ?? ""} — 세계의 15%를 새로 정복하거나 50턴 생존`
          : `${ui.world.polities[ui.playerId]?.name ?? ""} — conquer 15% of the world, or survive 50 turns`)
      : (lang === "ko"
          ? "지도에서 나라를 클릭해 다스릴 제국을 고르세요"
          : "Click a nation on the map to choose your realm");
    h.append(home, title, hint);
    return h;
  }

  function render(): void {
    root.innerHTML = "";
    root.appendChild(buildHeader());
    const map = buildMap();
    root.appendChild(map);
    if (!ui) {
      // picker: click any polity territory to play it
      map.addEventListener("click", (e) => {
        const el = (e.target as Element | null)?.closest?.("[data-polity]");
        if (el) startGame(Number(el.getAttribute("data-polity")));
      });
    } else {
      const oc = outcome(ui);
      if (oc) {
        const over = document.createElement("div");
        // survival is graded by growth so turtling reads as unremarkable and only expansion/domination feels earned
        const grade = survivalGrade(playerProvinceCount(ui), ui.startProvinces, ui.s.n);
        const survivalText = grade === "great" ? (lang === "ko" ? "강대국 — 왕조가 크게 뻗어나갔다" : "A great power — your realm expanded mightily")
          : grade === "grown" ? (lang === "ko" ? "생존 — 왕국을 넓히며 버텨냈다" : "Endured — you expanded and held on")
          : (lang === "ko" ? "겨우 버텨냈다 — 영토는 그대로였다" : "Merely endured — you held your ground, no more");
        over.className = "prov-over" + (oc.kind === "domination" ? " win" : oc.kind === "survival" && grade !== "held" ? " ok" : "");
        over.textContent =
          oc.kind === "defeat" ? (lang === "ko" ? `패배 — ${oc.by}에게 수도 함락` : `Defeat — capital taken by ${oc.by}`)
          : oc.kind === "domination" ? (lang === "ko" ? "🏆 지배 승리!" : "🏆 Domination victory!")
          : survivalText;
        const again = document.createElement("button"); again.className = "prov-again";
        again.textContent = lang === "ko" ? "다시" : "Play again";
        again.addEventListener("click", () => { ui = null; targets.clear(); log.length = 0; render(); });
        const nw = document.createElement("button"); nw.className = "prov-new";
        nw.textContent = lang === "ko" ? "새 세계" : "New world";
        nw.addEventListener("click", () => mountProvinceApp(root, {})); // fresh seed
        const bar = document.createElement("div"); bar.className = "prov-bar";
        bar.append(again, nw);
        root.append(over, bar);
        root.appendChild(logEl());
        return; // no target overlay / advance once the game is over
      }
      const hud = document.createElement("div");
      hud.className = "prov-hud";
      hud.textContent = hudText(ui);
      root.appendChild(hud);

      map.appendChild(defectionOverlay(ui));
      const risks: { p: number; r: NonNullable<ReturnType<typeof defectionRisk>> }[] = [];
      for (let p = 0; p < ui.s.n; p++) {
        if (ui.s.provOwner[p] !== ui.playerId) continue;
        const r = defectionRisk(ui.s, p);
        if (r) risks.push({ p, r });
      }
      if (risks.length) {
        const panel = document.createElement("div");
        panel.className = "prov-risk";
        for (const { p, r } of sortRisksByUrgency(risks)) {
          const row = document.createElement("div");
          row.className = "prov-risk-row";
          const turns = lang === "ko" ? `이탈 ${r.turnsLeft}턴` : `defects in ${r.turnsLeft}`;
          row.textContent = `⚠ ${ui.world.provinces[p].name} — ${turns} · ${defectionReasonText(r.reason, r.ownN, r.foeN, lang)}`;
          makePingable(row, ui, p);
          panel.appendChild(row);
        }
        const hint = document.createElement("div");
        hint.className = "prov-risk-hint";
        hint.textContent = lang === "ko"
          ? "내실로 다지거나, 압박하는 땅을 치세요"
          : "consolidate it, or take the province pressing it";
        panel.appendChild(hint);
        root.appendChild(panel);
      }

      // a pending dilemma takes over the turn — resolve it before doing anything else
      if (pendingDilemma) {
        root.appendChild(dilemmaCard(ui, pendingDilemma));
        root.appendChild(logEl());
        return;
      }

      // stance toggle: spend this turn expanding (Conquer) or shoring up your realm's stability (Consolidate)
      const stance = document.createElement("div");
      stance.className = "prov-stance";
      for (const m of ["conquer", "consolidate"] as const) {
        const b = document.createElement("button");
        b.className = "prov-stance-btn" + (mode === m ? " active" : "");
        b.dataset.mode = m;
        b.textContent = m === "conquer" ? (lang === "ko" ? "⚔ 정복" : "⚔ Conquer") : (lang === "ko" ? "🛡 내실" : "🛡 Consolidate");
        b.addEventListener("click", () => { if (mode !== m) { mode = m; targets.clear(); render(); } }); // attack vs fortify selections don't carry over
        stance.appendChild(b);
      }
      root.appendChild(stance);

      if (mode === "conquer") {
        const legend = document.createElement("div");
        legend.className = "prov-legend";
        legend.textContent = lang === "ko"
          ? "✓ = 점령 가능  ·  빗금 = 너무 강함  ·  ⚓ = 바다 건너 원정 — 지역에 마우스를 올리면 이유가 나와요"
          : "✓ = you can take  ·  hatched = too strong  ·  ⚓ = sea expedition — hover a province for the reason";
        root.appendChild(legend);
        map.appendChild(targetOverlay(ui));
        map.addEventListener("click", (e) => {
          const el = (e.target as Element | null)?.closest?.(".prov-target");
          if (!el) return;
          const p = Number(el.getAttribute("data-province"));
          if (targets.has(p)) targets.delete(p); else targets.add(p);
          render();
        });
        // battle preview: a readable line per targeted province — the numbers and the REASON, not just colour
        const preview = document.createElement("div");
        preview.className = "prov-preview";
        if (targets.size === 0) {
          preview.textContent = lang === "ko"
            ? "공격할 지역을 눌러 지정하면 전투 예측이 여기 표시됩니다"
            : "click provinces to target — the battle forecast appears here";
        } else {
          for (const p of [...targets].sort((a, b) => a - b)) {
            const od = explainAttack(ui.s, ui.playerId, p);
            const row = document.createElement("div");
            row.className = "prov-preview-row " + (od?.win ? "winnable" : "too-strong");
            row.textContent = (od?.win ? "✓ " : "✕ ") + attackLine(ui, p);
            preview.appendChild(row);
          }
        }
        root.appendChild(preview);
      } else {
        // consolidate mode: pick up to CONSOLIDATE_MAX of your OWN provinces to shore up — you can't shield all
        const hint = document.createElement("div");
        hint.className = "prov-legend";
        hint.textContent = lang === "ko"
          ? `🛡 지킬 지역을 최대 ${CONSOLIDATE_MAX}곳 선택 (창백할수록 취약) — 고른 곳만 튼튼해지고 나머지 전선은 무방비`
          : `🛡 pick up to ${CONSOLIDATE_MAX} of your provinces to shore up (paler = weaker) — the rest stay exposed`;
        root.appendChild(hint);
        map.appendChild(fortifyOverlay(ui));
        map.addEventListener("click", (e) => {
          const el = (e.target as Element | null)?.closest?.(".prov-fortify");
          if (!el) return;
          const p = Number(el.getAttribute("data-province"));
          if (targets.has(p)) targets.delete(p);
          else if (targets.size < CONSOLIDATE_MAX) targets.add(p);
          render();
        });
      }

      const bar = document.createElement("div");
      bar.className = "prov-bar";
      const advance = document.createElement("button");
      advance.className = "prov-advance";
      advance.textContent = mode === "consolidate"
        ? (lang === "ko" ? "내실 다지기 ▶" : "Consolidate ▶")
        : (lang === "ko" ? "정복 진행 ▶" : "Advance ▶");
      advance.addEventListener("click", () => {
        const pid = ui!.playerId;
        const ev = stepPlayerTurn(ui!.s, pid, targets, { consolidate: mode === "consolidate" });
        // categorise flips from the PLAYER's view: land I took vs land I lost (ignore AI-vs-AI flips)
        for (const c of ev.conquests) {
          if (c.to === pid) log.unshift({ text: `${lang === "ko" ? "정복" : "took"} ${ui!.world.provinces[c.prov].name}`, prov: c.prov });
          else if (c.from === pid) log.unshift({ text: `${lang === "ko" ? "상실" : "lost"} ${ui!.world.provinces[c.prov].name}`, prov: c.prov });
        }
        for (const d of ev.defections) {
          if (d.from === pid) log.unshift({ text: `${lang === "ko" ? "이탈" : "defected"} ${ui!.world.provinces[d.prov].name}`, prov: d.prov });
          else if (d.to === pid) log.unshift({ text: `${lang === "ko" ? "귀순" : "joined you"} ${ui!.world.provinces[d.prov].name}`, prov: d.prov });
        }
        for (const id of ev.eliminated) log.unshift({ text: `${ui!.world.polities[id]?.name ?? id} ${lang === "ko" ? "멸망" : "eliminated"}` });
        targets.clear();
        // a dilemma may arise from the new state (cooldown-gated, deterministic)
        if (!pendingDilemma && ui!.s.tick - lastDilemmaTick >= DILEMMA_COOLDOWN) {
          const d = offerProvinceDilemma(ui!.s, ui!.playerId);
          if (d) { pendingDilemma = d; lastDilemmaTick = ui!.s.tick; }
        }
        render();
      });
      bar.appendChild(advance);
      root.appendChild(bar);
      root.appendChild(logEl());
    }
  }
  // ONE debounced resize listener for the whole app — registered here, never inside render(), which runs
  // every turn (per-render registration would stack listeners). A resize changes the map's fitted width,
  // so the verdict badges must recompute their counter-scale. mountProvinceApp itself can be re-invoked
  // (the "New world" button calls it again on the same root), so drop any previous mount's listener first —
  // otherwise every re-mount leaves another permanent window-scoped listener behind.
  if (disposeActiveResize) disposeActiveResize();
  let resizeTimer = 0;
  const onResize = () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => { if (ui) render(); }, 150);
  };
  disposeActiveResize = () => {
    window.clearTimeout(resizeTimer);
    window.removeEventListener("resize", onResize);
  };
  window.addEventListener("resize", onResize);
  render();
}
