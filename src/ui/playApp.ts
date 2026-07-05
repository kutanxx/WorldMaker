import { generateWorld } from "../engine/world";
import { DEFAULT_PARAMS } from "../types/world";
import { aggregate } from "../engine/historySim";
import { initPlaySim, playTurn, setStance, scorecard, playerCells } from "../engine/playSim";
import type { Stance } from "../engine/historySim";
import { borderTargets, type Action } from "../engine/intervention";
import { renderWorld, politicalOpts } from "./svgWorldRenderer";
import { politicalLayer } from "./politicalLayer";

const STANCES: Stance[] = ["aggressive", "defensive", "internal"];
const LOW_COHESION = 0.4; // civil-war risk cue threshold

export function createPlayApp(root: HTMLElement, seed: number): void {
  root.innerHTML = "";
  const { world } = generateWorld({ ...DEFAULT_PARAMS, seed });

  // --- nation picker ---
  const picker = document.createElement("div");
  picker.className = "landing";
  const title = document.createElement("h1");
  title.className = "app-title";
  title.textContent = "Choose your realm";
  root.append(title, picker);

  const agg0 = (() => {
    const s = initPlaySim(world, seed, 0, "internal");
    return aggregate(s);
  })();
  world.polities
    .map((p) => ({ p, cells: agg0[p.id]?.cells ?? 0 }))
    .sort((a, b) => b.cells - a.cells)
    .forEach(({ p, cells }) => {
      const b = document.createElement("button");
      b.className = "nation-choice choice-card";
      b.innerHTML = `<span class="choice-title" style="color:${p.color}">${p.name}</span><span class="choice-sub">${cells} cells</span>`;
      b.addEventListener("click", () => startGame(p.id));
      picker.appendChild(b);
    });

  function startGame(playerPolity: number): void {
    root.innerHTML = "";
    const s = initPlaySim(world, seed, playerPolity, "internal");
    let pendingAction: Action | null = null;

    const stage = document.createElement("div");
    stage.className = "stage";
    const panel = document.createElement("div");
    panel.className = "play-panel controls";
    const actions = document.createElement("div");
    actions.className = "play-actions controls";
    const log = document.createElement("div");
    log.className = "chronicle";
    root.append(panel, stage, actions, log);

    const mapFrame = document.createElement("div");
    mapFrame.className = "map-frame";
    stage.appendChild(mapFrame);

    function renderMap(): void {
      mapFrame.innerHTML = "";
      const svg = renderWorld(world, "political", s.economicZones.map((z) => z.cell), "en");
      const slot = svg.querySelector(".political-slot") as SVGGElement;
      slot.replaceChildren(politicalLayer(world.grid, s.owner, s.polities, politicalOpts("political")));
      mapFrame.appendChild(svg);
    }

    function renderPanel(): void {
      const cells = playerCells(s);
      const agg = aggregate(s);
      const avg = agg[s.playerPolity]?.avg ?? 0;
      const threats = borderTargets(s).length;
      const risk = avg < LOW_COHESION ? ` · ⚠ civil-war risk (cohesion ${(avg * 100) | 0}%)` : "";
      panel.innerHTML =
        `<b class="play-year">Year ${s.tick * 10}</b> · ${s.polities[s.playerPolity].name}` +
        ` · ${cells} cells · cohesion ${(avg * 100) | 0}%${risk} · threats ${threats}`;
      const stanceRow = document.createElement("span");
      stanceRow.className = "view-toggle";
      for (const st of STANCES) {
        const btn = document.createElement("button");
        btn.textContent = st;
        btn.className = s.stance === st ? "active" : "";
        btn.addEventListener("click", () => { setStance(s, st); renderAll(); });
        stanceRow.appendChild(btn);
      }
      panel.appendChild(stanceRow);
    }

    function renderActions(): void {
      actions.innerHTML = "";
      const attackBtn = document.createElement("button");
      attackBtn.className = "btn-attack";
      attackBtn.textContent = pendingAction ? "Attack: chosen ✓" : "Attack…";
      const sel = document.createElement("select");
      sel.className = "attack-select";
      const none = document.createElement("option");
      none.value = ""; none.textContent = "— pick a border cell —";
      sel.appendChild(none);
      for (const t of borderTargets(s)) {
        const opt = document.createElement("option");
        opt.value = String(t.cell);
        opt.textContent = `${t.ownerName} (cell ${t.cell})${t.capturable ? " ✓" : " ✗"}`;
        sel.appendChild(opt);
      }
      sel.addEventListener("change", () => {
        pendingAction = sel.value ? { type: "attack", cell: Number(sel.value) } : null;
        attackBtn.textContent = pendingAction ? "Attack: chosen ✓" : "Attack…";
      });
      const advance = document.createElement("button");
      advance.className = "btn-advance";
      advance.textContent = "Advance year ▶";
      advance.addEventListener("click", () => {
        const r = playTurn(s, pendingAction);
        pendingAction = null;
        if (r.message) appendLog(`— ${r.message}`);
        for (const e of r.events) appendLog(e.text);
        if (r.finished) return end(r.defeated);
        renderAll();
      });
      actions.append(attackBtn, sel, advance);
    }

    function appendLog(text: string): void {
      const row = document.createElement("div");
      row.className = "chronicle-event";
      row.textContent = text;
      log.appendChild(row);
      log.scrollTop = log.scrollHeight;
    }

    function renderAll(): void { renderMap(); renderPanel(); renderActions(); }

    function end(defeated: boolean): void {
      const sc = scorecard(s);
      actions.innerHTML = "";
      renderPanel();
      const banner = document.createElement("div");
      banner.className = "stub";
      banner.innerHTML = defeated
        ? `<h2>Your realm fell in ${sc.survivedYears} years.</h2>`
        : `<h2>You endured 500 years.</h2>`;
      banner.innerHTML += `<p>Peak ${sc.peakCells} cells · final ${sc.cells} cells · rank ${sc.rank} of ${sc.nations}.</p>`;
      root.insertBefore(banner, log);
    }

    renderAll();
    appendLog(`Year 0 — you rule ${s.polities[playerPolity].name}.`);
  }
}
