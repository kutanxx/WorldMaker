import { generateWorld } from "../engine/world";
import { DEFAULT_PARAMS } from "../types/world";
import { initProvinceSim, pAggregate, PROVINCE_SIM_TICKS, type ProvinceSimState } from "../engine/provinceSim";
import { politicalLayer } from "./politicalLayer";
import { politicalBorders } from "../engine/borders";
import { segPath } from "./svgPaths";
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

export function mountProvinceApp(root: HTMLElement, opts: { seed?: number } = {}): void {
  const lang = detectLang();
  const seed = opts.seed ?? Math.floor(Date.now() % 1_000_000); // non-deterministic seed is fine — UI only
  const world = generateWorld({ ...DEFAULT_PARAMS, seed }).world;
  let ui: UI | null = null; // null = picker mode

  function playerProvinceCount(u: UI): number {
    let k = 0; for (let p = 0; p < u.s.n; p++) if (u.s.provOwner[p] === u.playerId) k++; return k;
  }
  function totalLandProvinces(u: UI): number { return u.s.n; }
  function liveRivals(u: UI): number { return u.s.alive.filter((a, id) => a && id !== u.playerId).length; }

  function buildMap(): SVGSVGElement {
    const s = ui ? ui.s : initProvinceSim(world); // picker previews the initial partition
    const owner = provinceCellOwner(world.grid.count, world.provinceOf, s.provOwner);
    const svg = svgEl("svg", {
      class: "prov-map", viewBox: `0 0 ${world.grid.width} ${world.grid.height}`, preserveAspectRatio: "xMidYMid meet",
    }) as SVGSVGElement;
    svg.appendChild(politicalLayer(
      world.grid, owner, world.polities,
      { fills: true, labels: true, legend: false, ...(ui ? { playerPolity: ui.playerId, playerColor: PLAYER_COLOR } : {}) },
    ));
    // politicalLayer's own border path is unclassed as "nation-border" (that class belongs to
    // provinceLayer's owner overlay) — since `owner` here is already province-snapped, draw the same
    // bold country-outline overlay directly so every province view agrees on where a country ends.
    svg.appendChild(svgEl("path", {
      class: "nation-border", d: segPath(politicalBorders(world.grid, owner)),
      fill: "none", stroke: "#161009", "stroke-width": 2, "stroke-opacity": 0.95, "stroke-linejoin": "round",
    }));
    return svg;
  }

  function startGame(playerId: number): void {
    const s = initProvinceSim(world);
    if (!s.alive[playerId]) return; // only live nations are playable
    const startProvinces = (() => { let k = 0; for (let p = 0; p < s.n; p++) if (s.provOwner[p] === playerId) k++; return k; })();
    ui = { world, s, playerId, startProvinces };
    render();
  }

  function hudText(u: UI): string {
    const avg = Math.round(pAggregate(u.s)[u.playerId].avg * 100);
    const capOk = u.s.alive[u.playerId];
    const t = { ko: { prov: "영토", sol: "안정도", turn: "턴", cap: "수도", capOk: "유지", capLost: "상실", rivals: "라이벌" },
                en: { prov: "provinces", sol: "stability", turn: "turn", cap: "capital", capOk: "held", capLost: "lost", rivals: "rivals" } }[lang];
    return `${t.prov} ${playerProvinceCount(u)}/${totalLandProvinces(u)} · ${t.sol} ${avg}% · ${t.turn} ${u.s.tick}/${PROVINCE_SIM_TICKS} · ${t.cap} ${capOk ? t.capOk : t.capLost} · ${t.rivals} ${liveRivals(u)}`;
  }

  function render(): void {
    root.innerHTML = "";
    const map = buildMap();
    root.appendChild(map);
    if (!ui) {
      // picker: click any polity territory to play it
      map.addEventListener("click", (e) => {
        const el = (e.target as Element | null)?.closest?.("[data-polity]");
        if (el) startGame(Number(el.getAttribute("data-polity")));
      });
    } else {
      const hud = document.createElement("div");
      hud.className = "prov-hud";
      hud.textContent = hudText(ui);
      root.appendChild(hud);
    }
  }
  render();
}
