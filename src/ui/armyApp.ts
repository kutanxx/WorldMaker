import { generateWorld } from "../engine/world";
import { DEFAULT_PARAMS } from "../types/world";
import {
  initArmySim, levy, maxLevy, moveArmy, previewMove, endTurn, armyAt, militiaOf,
  outcome, goalProgress, provinceCount, GOAL_GAIN_FRAC, HORIZON,
  type ArmyState, type Outcome,
} from "../engine/armySim";
import { politicalLayer } from "./politicalLayer";
import { politicalBorders } from "../engine/borders";
import { svgEl } from "./renderer";
import { cellPath, segPath } from "./svgPaths";

// PROTOTYPE UI. Click a province of yours to select it; levy and march/attack are both issued from
// the panel's buttons (never by clicking the map), so a misclick on a hostile neighbour can never
// destroy an army by accident. Everything the rules use is printed on the map.
export function mountArmyApp(root: HTMLElement, opts: { seed?: number } = {}): void {
  const seed = opts.seed ?? Math.floor(Date.now() % 1_000_000);
  const world = generateWorld({ ...DEFAULT_PARAMS, seed }).world;
  let s: ArmyState = initArmySim(world);
  let player: number | null = null;       // null = picker mode: click a nation on the map to start
  let startProv = 0;   // provinces held the moment this nation was picked — the goal is measured from here

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

    // land clip: the union of every OWNED cell's polygon — exactly the painted land (NOT "every
    // non-ocean cell": a non-ocean cell's Voronoi polygon can still span a narrow strait, so that
    // would mask nothing). Border strokes are clipped to this so a boundary line whose Voronoi edge
    // drags across open water is cut at the painted coastline. Id is namespaced ("army-land") so this
    // page's <clipPath> can never collide with provinceApp's "prov-land" if both are ever on one DOM.
    let landD = "";
    for (let c = 0; c < world.grid.count; c++) if (owner[c] >= 0) landD += cellPath(world.grid.polygons[c]);
    const clip = svgEl("clipPath", { id: "army-land" });
    clip.appendChild(svgEl("path", { d: landD }));
    svg.appendChild(clip);
    // province mesh: EVERY province boundary, including those inside one nation — otherwise same-owner
    // neighbours merge into one indistinguishable blob and the unit of action (a province) is invisible.
    // Non-interactive so it never steals the click-area hits appended below.
    svg.appendChild(svgEl("path", {
      class: "province-border", d: segPath(politicalBorders(world.grid, world.provinceOf)),
      fill: "none", stroke: "#3c2f1c", "stroke-width": 0.5, "stroke-opacity": 0.5,
      "clip-path": "url(#army-land)", "pointer-events": "none",
    }));
    // bold nation outline, drawn over the faint mesh so a country's edge still reads at a glance.
    svg.appendChild(svgEl("path", {
      class: "nation-border", d: segPath(politicalBorders(world.grid, owner)),
      fill: "none", stroke: "#161009", "stroke-width": 2, "stroke-opacity": 0.95, "stroke-linejoin": "round",
      "clip-path": "url(#army-land)", "pointer-events": "none",
    }));

    // one clickable hit area per province + its numbers. The label anchor is picked in the SAME
    // pass over grid cells that builds byProv: for each cell belonging to province p, track the
    // cell nearest that province's centroid. A raw centroid (arithmetic mean of cell positions)
    // can fall outside the province's own land for a crescent, a bay-hugging, or a peninsula
    // province — snapping to the province's own nearest cell guarantees the label sits on land
    // that actually belongs to it, without a second O(n) scan per province (ties: lower cell
    // index wins, so the map is stable across renders).
    const byProv: string[] = new Array(s.n).fill("");
    const anchorCell = new Int32Array(s.n).fill(-1);
    const anchorDist2 = new Float64Array(s.n).fill(Infinity);
    for (let c = 0; c < world.grid.count; c++) {
      const p = world.provinceOf[c];
      if (p < 0) continue;
      byProv[p] += cellPath(world.grid.polygons[c]);
      const [tx, ty] = world.provinces[p].centroid;
      const dx = world.grid.points[c * 2] - tx, dy = world.grid.points[c * 2 + 1] - ty;
      const d2 = dx * dx + dy * dy;
      if (d2 < anchorDist2[p]) { anchorDist2[p] = d2; anchorCell[p] = c; }
    }
    for (let p = 0; p < s.n; p++) {
      if (!byProv[p]) continue;
      const mine = player !== null && s.owner[p] === player;
      const hit = svgEl("path", {
        class: "army-prov" + (sel === p ? " sel" : ""), "data-prov": String(p), "data-mine": mine ? "1" : "0",
        "data-polity": String(s.owner[p]),
        d: byProv[p], fill: sel === p ? "rgba(232,181,58,0.35)" : "transparent", stroke: "none",
      });
      hit.addEventListener("click", () => {
        if (player === null) { startGame(s.owner[p]); return; }
        if (outcome(s, player, startProv)) return;   // game over: the map stops taking clicks
        onProvClick(p);
      });
      svg.appendChild(hit);
      const anchor = anchorCell[p] >= 0 ? anchorCell[p] : world.provinces[p].seedCell;
      const [cx, cy] = anchor >= 0
        ? [world.grid.points[anchor * 2], world.grid.points[anchor * 2 + 1]]
        : world.provinces[p].centroid;
      const army = s.armies.find((a) => a.prov === p);
      const label = svgEl("text", {
        class: "army-num", "data-prov": String(p), x: String(cx), y: String(cy), "text-anchor": "middle", "pointer-events": "none",
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

  function startGame(nation: number): void {
    if (nation >= 0) { player = nation; startProv = provinceCount(s, nation); sel = null; render(); }
  }

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
    const prog = goalProgress(s, me, startProv);
    const gainStr = `${prog.gained >= 0 ? "+" : ""}${prog.gained}`;
    const hud = document.createElement("div");
    hud.className = "army-hud";
    hud.textContent = `턴 ${s.turn} · 시드 ${seed} · ${world.polities[me]?.name ?? ""} · 영토 ${myProv()} · 정복 ${gainStr}/${prog.goal} · 인구 ${Math.round(myPop())} · 병력 ${myMen()}`;
    root.appendChild(hud);
    root.appendChild(buildMap());
    const oc: Outcome = outcome(s, me, startProv);
    if (oc) {
      const over = document.createElement("div");
      over.className = "army-over";
      over.textContent =
        oc.kind === "defeat" ? "패배 — 모든 영토를 잃었습니다"
        : oc.kind === "victory" ? `승리 — 세계의 ${Math.round(GOAL_GAIN_FRAC * 100)}%를 새로 정복했습니다`
        : `${HORIZON}턴 종료 — ${oc.rank}위 / ${oc.of}`;
      root.appendChild(over);
      const again = document.createElement("button");
      again.className = "army-restart";
      again.textContent = "다시";
      again.addEventListener("click", () => {
        s = initArmySim(world);           // a genuinely fresh game, not just cleared UI selection
        player = null; sel = null; startProv = 0; log.length = 0;
        render();
      });
      root.appendChild(again);
      const lg2 = document.createElement("div");
      lg2.className = "army-log";
      lg2.textContent = log.join("  ·  ");
      root.appendChild(lg2);
      return;                       // no panel, no end-turn button — the game is over
    }
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
