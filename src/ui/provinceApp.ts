import { generateWorld } from "../engine/world";
import { DEFAULT_PARAMS } from "../types/world";
import {
  initProvinceSim, pAggregate, PROVINCE_SIM_TICKS, armableTargets, stepPlayerTurn, type ProvinceSimState,
} from "../engine/provinceSim";
import { politicalLayer } from "./politicalLayer";
import { politicalBorders } from "../engine/borders";
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

const DOMINATION_MULT = 3;

export function mountProvinceApp(root: HTMLElement, opts: { seed?: number } = {}): void {
  const lang = detectLang();
  const seed = opts.seed ?? Math.floor(Date.now() % 1_000_000); // non-deterministic seed is fine — UI only
  const world = generateWorld({ ...DEFAULT_PARAMS, seed }).world;
  let ui: UI | null = null; // null = picker mode
  const targets = new Set<number>();
  const log: string[] = [];

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
    if (playerProvinceCount(u) >= DOMINATION_MULT * u.startProvinces) return { kind: "domination" };
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
    render();
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
      const path = svgEl("path", {
        class: "prov-target" + (targets.has(prov.id) ? " armed" : ""), "data-province": prov.id,
        d: byProv[prov.id], fill: targets.has(prov.id) ? "#e8b53a" : "transparent", "fill-opacity": targets.has(prov.id) ? 0.35 : 0,
        stroke: targets.has(prov.id) ? "#e8b53a" : "none", "stroke-width": 1.5,
      });
      g.appendChild(path);
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
          ? `${ui.world.polities[ui.playerId]?.name ?? ""} — 시작의 3배 정복 또는 50턴 생존`
          : `${ui.world.polities[ui.playerId]?.name ?? ""} — conquer 3× your start, or survive 50 turns`)
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
        over.className = "prov-over";
        over.textContent =
          oc.kind === "defeat" ? (lang === "ko" ? `패배 — ${oc.by}에게 수도 함락` : `Defeat — capital taken by ${oc.by}`)
          : oc.kind === "domination" ? (lang === "ko" ? "지배 승리!" : "Domination victory!")
          : (lang === "ko" ? "생존 승리 — 왕조가 살아남았다" : "Survival victory — your dynasty endured");
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

      map.appendChild(targetOverlay(ui));
      map.addEventListener("click", (e) => {
        const el = (e.target as Element | null)?.closest?.(".prov-target");
        if (!el) return;
        const p = Number(el.getAttribute("data-province"));
        if (targets.has(p)) targets.delete(p); else targets.add(p);
        render();
      });
      const bar = document.createElement("div");
      bar.className = "prov-bar";
      const advance = document.createElement("button");
      advance.className = "prov-advance";
      advance.textContent = lang === "ko" ? "진행 ▶" : "Advance ▶";
      advance.addEventListener("click", () => {
        const ev = stepPlayerTurn(ui!.s, ui!.playerId, targets);
        for (const c of ev.conquests) log.unshift(`${lang === "ko" ? "정복" : "took"} ${ui!.world.provinces[c.prov].name}`);
        for (const id of ev.eliminated) log.unshift(`${ui!.world.polities[id]?.name ?? id} ${lang === "ko" ? "멸망" : "eliminated"}`);
        targets.clear();
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
