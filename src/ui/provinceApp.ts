import { generateWorld } from "../engine/world";
import { DEFAULT_PARAMS } from "../types/world";
import {
  initProvinceSim, pAggregate, PROVINCE_SIM_TICKS, armableTargets, stepPlayerTurn, explainAttack,
  offerProvinceDilemma, resolveProvinceDilemma,
  type ProvinceSimState, type AttackReason, type ProvinceDilemma,
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

// Domination = you have CONQUERED a fifth of the map beyond where you started. Additive (not ×start) so it is
// start-fair: a tiny realm and a large one must both take the same absolute number of provinces, a big start
// never wins instantly (gain is 0 at t0), and a small start can't win by grabbing 2 neighbours. SP3-tunable.
const DOMINATION_GAIN_FRAC = 0.2;
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

export function mountProvinceApp(root: HTMLElement, opts: { seed?: number } = {}): void {
  const lang = detectLang();
  const seed = opts.seed ?? Math.floor(Date.now() % 1_000_000); // non-deterministic seed is fine — UI only
  const world = generateWorld({ ...DEFAULT_PARAMS, seed }).world;
  let ui: UI | null = null; // null = picker mode
  const targets = new Set<number>();
  const log: string[] = [];
  let mode: "conquer" | "consolidate" = "conquer"; // this turn: expand, or shore up my realm
  let pendingDilemma: ProvinceDilemma | null = null; // a choice card awaiting the player
  let lastDilemmaTick = -99;
  const DILEMMA_COOLDOWN = 4; // don't spam cards — min turns between offers

  function playerProvinceCount(u: UI): number {
    let k = 0; for (let p = 0; p < u.s.n; p++) if (u.s.provOwner[p] === u.playerId) k++; return k;
  }
  function totalLandProvinces(u: UI): number { return u.s.n; }
  function liveRivals(u: UI): number { return u.s.alive.filter((a, id) => a && id !== u.playerId).length; }

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

  // expedition sea lanes: a dashed route between each linked province pair's centroids. Play mode only;
  // pointer-events off so it never blocks target clicks. Deduped by p < q.
  function seaLaneLayer(u: UI): SVGGElement {
    const g = svgEl("g", { class: "prov-lanes", style: "pointer-events:none" }) as SVGGElement;
    const laneAdj = u.s.laneAdj ?? [];
    for (let p = 0; p < laneAdj.length; p++) for (const q of laneAdj[p]) {
      if (q <= p) continue; // draw each undirected lane once
      const a = u.world.provinces[p].centroid, b = u.world.provinces[q].centroid;
      g.appendChild(svgEl("line", {
        class: "sea-lane", x1: a[0], y1: a[1], x2: b[0], y2: b[1],
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

  // clean OUTLINE of a whole province (its boundary against other provinces + ocean), not the jagged
  // per-cell mesh — so the highlight reads as a province, not a pile of cells.
  function provinceOutlinePath(u: UI, provId: number): string {
    const grid = u.world.grid;
    const po = u.world.provinceOf;
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

  function targetOverlay(u: UI): SVGGElement {
    const arm = new Set(armableTargets(u.s, u.playerId));
    const byProv: string[] = u.world.provinces.map(() => "");
    for (let c = 0; c < u.world.grid.count; c++) {
      const p = u.world.provinceOf[c];
      if (p >= 0 && arm.has(p)) byProv[p] += cellPath(u.world.grid.polygons[c]);
    }
    const g = svgEl("g", { class: "prov-targets" }) as SVGGElement;
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
      // armed provinces get a clean gold PROVINCE outline (not the cell mesh) to show the selection.
      if (armed) {
        g.appendChild(svgEl("path", {
          class: "prov-target-ring", style: "pointer-events:none", d: provinceOutlinePath(u, prov.id),
          fill: "none", stroke: "#e8b53a", "stroke-width": 2.2, "stroke-linejoin": "round",
        }));
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
        class: "prov-fortify-ring", style: "pointer-events:none", d: provinceOutlinePath(u, prov.id),
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
    const body = document.createElement("div"); body.className = "prov-dilemma-body"; body.textContent = T[1];
    const bar = document.createElement("div"); bar.className = "prov-bar";
    for (const [choice, label] of [["a", T[2]], ["b", T[3]]] as const) {
      const b = document.createElement("button");
      b.className = "prov-choice"; b.dataset.choice = choice; b.textContent = label;
      b.addEventListener("click", () => {
        resolveProvinceDilemma(u.s, u.playerId, d, choice);
        log.unshift(`${lang === "ko" ? "결정" : "chose"}: ${(choice === "a" ? T[2] : T[3]).split(" (")[0]}`);
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
          ? `${ui.world.polities[ui.playerId]?.name ?? ""} — 세계의 1/5을 새로 정복하거나 50턴 생존`
          : `${ui.world.polities[ui.playerId]?.name ?? ""} — conquer a fifth of the world, or survive 50 turns`)
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
        const logEl = document.createElement("div"); logEl.className = "prov-log";
        logEl.textContent = log.slice(0, 8).join(" · ");
        root.appendChild(logEl);
        return; // no target overlay / advance once the game is over
      }
      const hud = document.createElement("div");
      hud.className = "prov-hud";
      hud.textContent = hudText(ui);
      root.appendChild(hud);

      // a pending dilemma takes over the turn — resolve it before doing anything else
      if (pendingDilemma) {
        root.appendChild(dilemmaCard(ui, pendingDilemma));
        const logEl = document.createElement("div");
        logEl.className = "prov-log";
        logEl.textContent = log.slice(0, 8).join(" · ");
        root.appendChild(logEl);
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
          ? "✓ 초록 = 점령 가능  ·  ✕ 빨강 = 너무 강함  ·  ⚓ = 바다 건너 원정 — 지역에 마우스를 올리면 이유가 나와요"
          : "✓ green = you can take  ·  ✕ red = too strong  ·  ⚓ = sea expedition — hover a province for the reason";
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
          if (c.to === pid) log.unshift(`${lang === "ko" ? "정복" : "took"} ${ui!.world.provinces[c.prov].name}`);
          else if (c.from === pid) log.unshift(`${lang === "ko" ? "상실" : "lost"} ${ui!.world.provinces[c.prov].name}`);
        }
        for (const id of ev.eliminated) log.unshift(`${ui!.world.polities[id]?.name ?? id} ${lang === "ko" ? "멸망" : "eliminated"}`);
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
      const logEl = document.createElement("div");
      logEl.className = "prov-log";
      logEl.textContent = log.slice(0, 8).join(" · ");
      root.appendChild(logEl);
    }
  }
  render();
}
