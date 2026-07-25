import { generateWorld } from "../engine/world";
import { DEFAULT_PARAMS } from "../types/world";
import {
  initArmySim, levy, maxLevy, moveArmy, previewMove, endTurn, armyAt, militiaOf,
  type ArmyState,
} from "../engine/armySim";
import { politicalLayer } from "./politicalLayer";
import { svgEl } from "./renderer";
import { cellPath } from "./svgPaths";

// PROTOTYPE UI. Click a province of yours to select it; levy and march/attack are both issued from
// the panel's buttons (never by clicking the map), so a misclick on a hostile neighbour can never
// destroy an army by accident. Everything the rules use is printed on the map.
export function mountArmyApp(root: HTMLElement, opts: { seed?: number } = {}): void {
  const seed = opts.seed ?? Math.floor(Date.now() % 1_000_000);
  const world = generateWorld({ ...DEFAULT_PARAMS, seed }).world;
  const s: ArmyState = initArmySim(world);
  let player: number | null = null;       // null = picker mode: click a nation on the map to start

  let sel: number | null = null;          // selected province (mine)
  const log: string[] = [];
  const say = (t: string) => { log.unshift(`T${s.turn} ${t}`); if (log.length > 10) log.pop(); };

  const myPop = () => { let v = 0; for (let p = 0; p < s.n; p++) if (s.owner[p] === player) v += s.pop[p]; return v; };
  const myMen = () => s.armies.filter((a) => a.nation === player).reduce((k, a) => k + a.men, 0);
  const myProv = () => { let k = 0; for (let p = 0; p < s.n; p++) if (s.owner[p] === player) k++; return k; };

  function buildMap(): SVGSVGElement {
    const svg = svgEl("svg", {
      class: "army-map", viewBox: `0 0 ${world.grid.width} ${world.grid.height}`,
      preserveAspectRatio: "xMidYMid meet",
    }) as SVGSVGElement;
    const owner = new Int32Array(world.grid.count).fill(-1);
    for (let c = 0; c < world.grid.count; c++) { const p = world.provinceOf[c]; if (p >= 0) owner[c] = s.owner[p]; }
    svg.appendChild(politicalLayer(world.grid, owner, world.polities, { fills: true, labels: false, legend: false }));

    // one clickable hit area per province + its numbers
    const byProv: string[] = new Array(s.n).fill("");
    for (let c = 0; c < world.grid.count; c++) {
      const p = world.provinceOf[c];
      if (p >= 0) byProv[p] += cellPath(world.grid.polygons[c]);
    }
    for (let p = 0; p < s.n; p++) {
      if (!byProv[p]) continue;
      const mine = player !== null && s.owner[p] === player;
      const hit = svgEl("path", {
        class: "army-prov" + (sel === p ? " sel" : ""), "data-prov": String(p), "data-mine": mine ? "1" : "0",
        "data-polity": String(s.owner[p]),
        d: byProv[p], fill: sel === p ? "rgba(232,181,58,0.35)" : "transparent", stroke: "none",
      });
      hit.addEventListener("click", () => { if (player === null) startGame(s.owner[p]); else onProvClick(p); });
      svg.appendChild(hit);
      const [cx, cy] = world.provinces[p].centroid;
      const army = s.armies.find((a) => a.prov === p);
      const label = svgEl("text", {
        class: "army-num", x: String(cx), y: String(cy), "text-anchor": "middle", "pointer-events": "none",
      });
      label.textContent = army ? `${Math.round(s.pop[p])}·⚔${army.men}` : `${Math.round(s.pop[p])}`;
      svg.appendChild(label);
    }
    if (player === null) {
      const stat = new Map<number, { prov: number; pop: number }>();
      for (let p = 0; p < s.n; p++) {
        const o = s.owner[p];
        if (o < 0) continue;
        const v = stat.get(o) ?? { prov: 0, pop: 0 };
        v.prov++; v.pop += s.pop[p];
        stat.set(o, v);
      }
      for (const [id, v] of [...stat].sort((a, b) => a[0] - b[0])) {
        const cap = world.polities[id]?.capital;
        if (cap === undefined) continue;
        const label = svgEl("text", {
          class: "army-pick-label", "data-polity": String(id), "pointer-events": "none",
          x: String(world.grid.points[cap * 2]), y: String(world.grid.points[cap * 2 + 1]), "text-anchor": "middle",
        });
        label.textContent = `${world.polities[id]?.name ?? id} · 영토 ${v.prov} · 인구 ${Math.round(v.pop)}`;
        svg.appendChild(label);
      }
    }
    return svg;
  }

  function startGame(nation: number): void { if (nation >= 0) { player = nation; sel = null; render(); } }

  // clicking the map only ever selects one of your own provinces (or clears the selection) —
  // marching is issued from the panel's per-target buttons, never by a map click, so a misclick
  // on a hostile neighbour can never destroy an army without a deliberate confirming click.
  function onProvClick(p: number): void {
    sel = s.owner[p] === player ? p : null;
    render();
  }

  function issueMove(from: number, target: number): void {
    const r = moveArmy(s, from, player!, target);
    if (r) {
      say(r.captured ? `점령 ${world.provinces[target].name} (손실 ${r.attackerLosses}, ${Math.round(r.p * 100)}%)`
        : r.won ? `이동 ${world.provinces[target].name}`
        : `패배 ${world.provinces[target].name} — 전멸 (${Math.round(r.p * 100)}% 였음)`);
    }
    sel = null;
    render();
  }

  function panel(): HTMLElement {
    const box = document.createElement("div");
    box.className = "army-sel";
    if (sel === null) { box.textContent = "내 영토를 클릭해 선택하세요. 징집과 행군은 아래 버튼으로 실행합니다."; return box; }
    const p = sel, name = world.provinces[p].name;
    const a = armyAt(s, p, player!);
    const head = document.createElement("div");
    head.textContent = `${name} · 인구 ${Math.round(s.pop[p])} · 민병 ${militiaOf(s, p)}` + (a ? ` · 병력 ${a.men}` : "");
    box.appendChild(head);
    const levyAmount = maxLevy(s, p);
    const btn = document.createElement("button");
    btn.className = "army-levy";
    btn.textContent = `징집 (+${levyAmount}명, 인구 −${levyAmount})`;
    btn.disabled = levyAmount === 0;
    btn.addEventListener("click", () => { const m = levy(s, p, player!); if (m > 0) say(`징집 ${name} +${m}`); render(); });
    box.appendChild(btn);
    if (a) {
      const spent = a.movedOn === s.turn;
      if (spent) {
        const note = document.createElement("div");
        note.className = "army-spent";
        note.textContent = "이미 이동함";
        box.appendChild(note);
      }
      const list = document.createElement("div");
      list.className = "army-moves";
      for (const q of s.adj[p]) {
        const r = previewMove(s, p, player!, q);
        if (!r) continue;
        const row = document.createElement("button");
        row.className = "army-move";
        row.dataset.target = String(q);
        row.disabled = spent;
        row.textContent = s.owner[q] === player
          ? `→ ${world.provinces[q].name} (행군)`
          : `→ ${world.provinces[q].name} · 공격 ${r.atk} vs 방어 ${Math.ceil(r.def)} · ${Math.round(r.p * 100)}%`;
        row.addEventListener("click", () => issueMove(p, q));
        list.appendChild(row);
      }
      box.appendChild(list);
    }
    return box;
  }

  function render(): void {
    root.innerHTML = "";
    if (player === null) {
      const pick = document.createElement("div");
      pick.className = "army-pick";
      pick.textContent = "지도에서 나라를 클릭해 고르세요 — 작은 나라는 어렵고, 큰 나라는 지킬 게 많습니다.";
      root.appendChild(pick);
      root.appendChild(buildMap());
      return;
    }
    const me = player;
    const hud = document.createElement("div");
    hud.className = "army-hud";
    hud.textContent = `턴 ${s.turn} · 시드 ${seed} · ${world.polities[me]?.name ?? ""} · 영토 ${myProv()} · 인구 ${Math.round(myPop())} · 병력 ${myMen()}`;
    root.appendChild(hud);
    root.appendChild(buildMap());
    root.appendChild(panel());
    const end = document.createElement("button");
    end.className = "army-end";
    end.textContent = "턴 종료 ▶";
    end.addEventListener("click", () => { endTurn(s, me); sel = null; render(); });
    root.appendChild(end);
    const lg = document.createElement("div");
    lg.className = "army-log";
    lg.textContent = log.join("  ·  ");
    root.appendChild(lg);
  }

  render();
}
