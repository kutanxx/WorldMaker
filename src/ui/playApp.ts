import { generateWorld } from "../engine/world";
import { DEFAULT_PARAMS } from "../types/world";
import { aggregate, YEARS_PER_TICK } from "../engine/historySim";
import { initPlaySim, playTurn, setStance, scorecard, playerCells } from "../engine/playSim";
import type { Stance } from "../engine/historySim";
import { borderTargets, frontEdges, foundCityTargets, hostileNeighbors, type Action } from "../engine/intervention";
import { sharedEdge } from "../engine/borders";
import { renderWorld, politicalOpts } from "./svgWorldRenderer";
import { politicalLayer } from "./politicalLayer";
import { t, playT, playYear, playLog, playRuleIntro, playFell, playStats, playDelta, playDefeatCause, type Lang } from "./i18n";

const STANCES: Stance[] = ["aggressive", "defensive", "internal"];
const LOW_COHESION = 0.4; // civil-war risk cue threshold

export function createPlayApp(root: HTMLElement, seed: number): void {
  root.innerHTML = "";
  const { world } = generateWorld({ ...DEFAULT_PARAMS, seed });
  let lang: Lang = "en";

  const agg0 = (() => {
    const s = initPlaySim(world, seed, 0, "internal");
    return aggregate(s);
  })();
  const nationsByCells = world.polities
    .map((p) => ({ p, cells: agg0[p.id]?.cells ?? 0 }))
    .sort((a, b) => b.cells - a.cells);

  // a small KO/EN toggle reused on both screens
  function langButton(onToggle: () => void): HTMLButtonElement {
    const b = document.createElement("button");
    b.className = "lang-toggle";
    b.textContent = t(lang, "langToggle");
    b.addEventListener("click", () => { lang = lang === "en" ? "ko" : "en"; onToggle(); });
    return b;
  }

  // --- nation picker ---
  function renderPicker(): void {
    root.innerHTML = "";
    const title = document.createElement("h1");
    title.className = "app-title";
    title.textContent = playT(lang, "chooseRealm");
    const picker = document.createElement("div");
    picker.className = "landing";
    root.append(title, langButton(renderPicker), picker);
    for (const { p, cells } of nationsByCells) {
      const b = document.createElement("button");
      b.className = "nation-choice choice-card";
      b.innerHTML = `<span class="choice-title" style="color:${p.color}">${p.name}</span><span class="choice-sub">${cells} ${playT(lang, "cells")}</span>`;
      b.addEventListener("click", () => startGame(p.id));
      picker.appendChild(b);
    }
  }

  function startGame(playerPolity: number): void {
    root.innerHTML = "";
    const s = initPlaySim(world, seed, playerPolity, "internal");
    let pendingAction: Action | null = null;
    let over = false;

    const panel = document.createElement("div");
    panel.className = "play-panel controls";
    const stage = document.createElement("div");
    stage.className = "stage";
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
      const svg = renderWorld(world, "political", s.economicZones.map((z) => z.cell), lang);
      const slot = svg.querySelector(".political-slot") as SVGGElement;
      slot.replaceChildren(politicalLayer(world.grid, s.owner, s.polities, politicalOpts("political")));
      // front-line overlay: green = can push here, red = my cell is vulnerable here
      const NS = "http://www.w3.org/2000/svg";
      const g = document.createElementNS(NS, "g");
      g.setAttribute("class", "front");
      for (const e of frontEdges(s)) {
        const seg = sharedEdge(world.grid.polygons[e.cell], world.grid.polygons[e.enemy]);
        if (!seg) continue;
        const line = document.createElementNS(NS, "line");
        line.setAttribute("x1", String(seg[0][0])); line.setAttribute("y1", String(seg[0][1]));
        line.setAttribute("x2", String(seg[1][0])); line.setAttribute("y2", String(seg[1][1]));
        line.setAttribute("class", e.kind === "threat" ? "front-threat" : "front-push");
        line.setAttribute("stroke", e.kind === "threat" ? "#c0473f" : "#3f9e57");
        line.setAttribute("stroke-width", "2.4");
        line.setAttribute("stroke-linecap", "round");
        g.appendChild(line);
      }
      // amphibious opportunities: a small ⛵ at each capturable sea target
      for (const target of borderTargets(s)) {
        if (!target.sea || !target.capturable) continue;
        const tx = document.createElementNS(NS, "text");
        tx.setAttribute("x", String(world.grid.points[target.cell * 2]));
        tx.setAttribute("y", String(world.grid.points[target.cell * 2 + 1]));
        tx.setAttribute("class", "sea-target");
        tx.setAttribute("text-anchor", "middle");
        tx.setAttribute("font-size", "10");
        tx.textContent = "⛵";
        g.appendChild(tx);
      }
      // player-founded cities: gold star (dim outline when the anchor was captured)
      for (const fc of s.foundedCities) {
        const tx = document.createElementNS(NS, "text");
        tx.setAttribute("x", String(world.grid.points[fc * 2]));
        tx.setAttribute("y", String(world.grid.points[fc * 2 + 1]));
        tx.setAttribute("class", "founded-city");
        tx.setAttribute("text-anchor", "middle");
        tx.setAttribute("font-size", "9");
        tx.setAttribute("fill", "#a8842c");
        tx.setAttribute("pointer-events", "none");
        tx.textContent = s.owner[fc] === s.playerPolity ? "★" : "☆";
        g.appendChild(tx);
      }
      slot.parentNode!.insertBefore(g, slot.nextSibling); // above political fills, below markers
      mapFrame.appendChild(svg);
    }

    function renderPanel(): void {
      const year = playYear(lang, s.tick * YEARS_PER_TICK);
      const name = s.polities[s.playerPolity].name;
      // a fallen realm has no cells, cohesion, or stance to speak of — don't show a civil-war warning
      // on a 0-cell dead nation (the scorecard banner tells the real story)
      if (!s.alive[s.playerPolity]) {
        panel.innerHTML = `<b class="play-year">${year}</b> · ${name} — ${playT(lang, "fallen")}`;
        panel.appendChild(langButton(rerender));
        return;
      }
      const cells = playerCells(s);
      const agg = aggregate(s);
      const avg = agg[s.playerPolity]?.avg ?? 0;
      const pct = (avg * 100) | 0;
      const threats = borderTargets(s).length;
      const risk = avg < LOW_COHESION ? ` · ⚠ ${playT(lang, "civilWarRisk")} (${playT(lang, "cohesion")} ${pct}%)` : "";
      panel.innerHTML =
        `<b class="play-year">${year}</b> · ${name}` +
        ` · ${cells} ${playT(lang, "cells")} · ${playT(lang, "cohesion")} ${pct}%${risk} · ${playT(lang, "threats")} ${threats}`;
      const stanceRow = document.createElement("span");
      stanceRow.className = "view-toggle";
      for (const st of STANCES) {
        const btn = document.createElement("button");
        btn.textContent = playT(lang, st);
        btn.className = s.stance === st ? "active" : "";
        btn.addEventListener("click", () => { setStance(s, st); renderAll(); });
        stanceRow.appendChild(btn);
      }
      panel.append(stanceRow, langButton(rerender));
    }

    function renderActions(): void {
      actions.innerHTML = "";
      // the player gets ONE action per turn; attack and invest share the slot (picking one clears the other)
      const status = document.createElement("button");
      status.className = "btn-attack"; // status label (kept class name for existing consumers)
      const label = () =>
        !pendingAction ? playT(lang, "noAction")
          : pendingAction.type === "attack" ? playT(lang, "attackChosen")
            : pendingAction.type === "foundCity" ? playT(lang, "foundChosen")
              : pendingAction.type === "peace" ? playT(lang, "peaceChosen")
                : playT(lang, pendingAction.scope === "border" ? "investFrontierChosen" : "investRealmChosen");
      status.textContent = label();

      const sel = document.createElement("select");
      sel.className = "attack-select";
      const none = document.createElement("option");
      none.value = ""; none.textContent = playT(lang, "attackPlaceholder");
      sel.appendChild(none);
      for (const target of borderTargets(s)) {
        const opt = document.createElement("option");
        opt.value = String(target.cell);
        opt.textContent = `${target.sea ? "⛵ " : ""}${target.ownerName} (cell ${target.cell})${target.capturable ? " ✓" : " ✗"}`;
        sel.appendChild(opt);
      }

      const inv = document.createElement("select");
      inv.className = "invest-select";
      for (const [value, key] of [["", "investPlaceholder"], ["nation", "investRealmOpt"], ["border", "investFrontierOpt"]] as const) {
        const opt = document.createElement("option");
        opt.value = value; opt.textContent = playT(lang, key);
        inv.appendChild(opt);
      }

      // found-city: best (most cohesive) eligible sites first, capped to keep the list scannable
      const fnd = document.createElement("select");
      fnd.className = "found-select";
      const fndNone = document.createElement("option");
      fndNone.value = ""; fndNone.textContent = playT(lang, "foundPlaceholder");
      fnd.appendChild(fndNone);
      for (const target of foundCityTargets(s).slice(0, 20)) {
        const opt = document.createElement("option");
        opt.value = String(target.cell);
        opt.textContent = `cell ${target.cell} · ${(target.sol * 100) | 0}%`;
        fnd.appendChild(opt);
      }

      const pce = document.createElement("select");
      pce.className = "peace-select";
      const pceNone = document.createElement("option");
      pceNone.value = ""; pceNone.textContent = playT(lang, "peacePlaceholder");
      pce.appendChild(pceNone);
      for (const h of hostileNeighbors(s)) {
        const opt = document.createElement("option");
        opt.value = String(h.id);
        opt.textContent = h.trucedUntil > s.tick ? `${h.name} ✓` : h.name;
        pce.appendChild(opt);
      }

      // one action per turn: picking in any select clears the other three
      const selects = [sel, inv, fnd, pce];
      const clearOthers = (keep: HTMLSelectElement) => {
        for (const other of selects) if (other !== keep) other.value = "";
      };
      sel.addEventListener("change", () => {
        pendingAction = sel.value ? { type: "attack", cell: Number(sel.value) } : null;
        if (pendingAction) clearOthers(sel);
        status.textContent = label();
      });
      inv.addEventListener("change", () => {
        pendingAction = inv.value ? { type: "invest", scope: inv.value as "nation" | "border" } : null;
        if (pendingAction) clearOthers(inv);
        status.textContent = label();
      });
      fnd.addEventListener("change", () => {
        pendingAction = fnd.value ? { type: "foundCity", cell: Number(fnd.value) } : null;
        if (pendingAction) clearOthers(fnd);
        status.textContent = label();
      });
      pce.addEventListener("change", () => {
        pendingAction = pce.value ? { type: "peace", polity: Number(pce.value) } : null;
        if (pendingAction) clearOthers(pce);
        status.textContent = label();
      });

      const advance = document.createElement("button");
      advance.className = "btn-advance";
      advance.textContent = playT(lang, "advance");
      advance.addEventListener("click", () => {
        const before = Int32Array.from(s.owner);
        const r = playTurn(s, pendingAction);
        pendingAction = null;
        let gained = 0, lost = 0;
        for (let c = 0; c < s.n; c++) {
          const was = before[c] === s.playerPolity, now = s.owner[c] === s.playerPolity;
          if (now && !was) gained++; else if (was && !now) lost++;
        }
        appendLog(playDelta(lang, r.year, gained, lost));
        const msg = playLog(lang, r.actionCode, r.actionData);
        if (msg) appendLog(`— ${msg}`);
        for (const e of r.events) {
          const hl = isPlayerEvent(e);
          appendLog(hl ? `${HEADLINE_ICON[e.type] ?? "•"} ${e.text}` : e.text, hl);
        }
        if (r.finished) {
          const conq = r.events.find((e) => e.type === "conquer" && e.otherId === s.playerPolity);
          return end(r.defeated, conq ? s.polities[conq.polityId].name : "");
        }
        renderAll();
      });
      actions.append(status, sel, inv, fnd, pce, advance);
    }

    function appendLog(text: string, headline = false): void {
      if (!text) return;
      const row = document.createElement("div");
      row.className = headline ? "chronicle-event headline" : "chronicle-event";
      row.textContent = text;
      log.appendChild(row);
      log.scrollTop = log.scrollHeight;
    }

    const HEADLINE_ICON: Record<string, string> = {
      civilwar: "⚔", independence: "🏴", conquer: "👑", goldenage: "☀",
    };
    function isPlayerEvent(e: { polityId: number; otherId?: number }): boolean {
      return e.polityId === s.playerPolity || e.otherId === s.playerPolity;
    }

    function renderAll(): void { renderMap(); renderPanel(); renderActions(); }

    // re-render the live screen in the current language (keeps the accumulated log)
    function rerender(): void {
      if (over) { renderMap(); renderPanel(); renderBanner(); } else renderAll();
    }

    let defeatedFlag = false;
    let defeatCause = "";
    function renderBanner(): void {
      root.querySelector(".stub")?.remove();
      const sc = scorecard(s);
      const banner = document.createElement("div");
      banner.className = "stub";
      const head = defeatedFlag ? playFell(lang, sc.survivedYears) : playT(lang, "endured");
      const rankText = sc.rank > 0 ? `${sc.rank} / ${sc.nations}` : "—";
      const cause = defeatedFlag && defeatCause ? ` ${playDefeatCause(lang, defeatCause)}` : "";
      banner.innerHTML = `<h2>${head}${cause}</h2><p>${playStats(lang, sc.peakCells, sc.cells, rankText, sc.citiesFounded)}</p>`;
      root.insertBefore(banner, log);
    }

    function end(defeated: boolean, conqueror = ""): void {
      over = true;
      defeatedFlag = defeated;
      defeatCause = conqueror;
      actions.innerHTML = "";
      renderPanel();
      renderBanner();
    }

    renderAll();
    appendLog(playRuleIntro(lang, s.polities[playerPolity].name));
  }

  renderPicker();
}
