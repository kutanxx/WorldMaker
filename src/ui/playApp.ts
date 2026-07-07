import { generateWorld } from "../engine/world";
import { DEFAULT_PARAMS } from "../types/world";
import { aggregate, YEARS_PER_TICK } from "../engine/historySim";
import { initPlaySim, playTurn, setStance, scorecard, playerCells } from "../engine/playSim";
import type { Stance } from "../engine/historySim";
import { borderTargets, frontEdges, foundCityTargets, hostileNeighbors, predictCapture, INVEST_DELTA, type Action } from "../engine/intervention";
import { OCEAN } from "../engine/terrain";
import { sharedEdge } from "../engine/borders";
import { cellPath } from "./svgPaths";
import { renderWorld, politicalOpts } from "./svgWorldRenderer";
import { reignChronicle } from "../engine/reign";
import { downloadBlob } from "./export";
import { politicalLayer } from "./politicalLayer";
import { t, playT, playYear, playLog, playRuleIntro, playFell, playStats, playDelta, playDefeatCause, playDilemma, playDilemmaOutcome, type Lang } from "./i18n";
import { offerDilemma, resolveDilemma, type Dilemma } from "../engine/dilemma";

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
    const maxCells = nationsByCells[0]?.cells || 1;
    for (const { p, cells } of nationsByCells) {
      const b = document.createElement("button");
      b.className = "nation-choice choice-card";
      // picking a realm IS picking a difficulty — say so (big = safe start, small = hard mode)
      const diff = cells >= maxCells * 0.66 ? "diffEasy" : cells >= maxCells * 0.33 ? "diffNormal" : "diffHard";
      b.innerHTML = `<span class="choice-title" style="color:${p.color}">${p.name}</span><span class="choice-sub">${cells} ${playT(lang, "cells")} · ${playT(lang, diff)}</span>`;
      b.addEventListener("click", () => startGame(p.id));
      picker.appendChild(b);
    }
  }

  function startGame(playerPolity: number): void {
    root.innerHTML = "";
    const s = initPlaySim(world, seed, playerPolity, "internal");
    let pendingAction: Action | null = null;
    let dilemma: Dilemma | null = null;
    let over = false;
    let showHelp = true; // the how-to-rule card opens the reign; dismissible, reopenable via "?"

    const howtoBox = document.createElement("div");
    howtoBox.className = "howto-slot";
    const panel = document.createElement("div");
    panel.className = "play-panel controls";
    const dilemmaBox = document.createElement("div");
    dilemmaBox.className = "dilemma controls";
    dilemmaBox.style.display = "none";
    const stage = document.createElement("div");
    stage.className = "stage";
    const actions = document.createElement("div");
    actions.className = "play-actions controls";
    const log = document.createElement("div");
    log.className = "chronicle";
    // game layout: big map on the left, everything the player reads/clicks in a right sidebar —
    // the vertical pile of cards was unreadable (user feedback); the how-to card floats as an overlay
    const grid = document.createElement("div");
    grid.className = "play-grid";
    const main = document.createElement("div");
    main.className = "play-main";
    const side = document.createElement("div");
    side.className = "play-side";
    main.appendChild(stage);
    side.append(panel, dilemmaBox, actions, log);
    grid.append(main, side);
    root.append(howtoBox, grid);

    const mapFrame = document.createElement("div");
    mapFrame.className = "map-frame";
    const legend = document.createElement("div");
    legend.className = "play-legend";
    stage.append(mapFrame, legend);

    // same frontier rule the invest action uses (any non-ocean neighbour that isn't ours)
    const isFrontier = (c: number) =>
      world.grid.neighbors[c].some((nb) => world.terrain[nb] !== OCEAN && s.owner[nb] !== s.playerPolity);

    // what an invest would actually do right now: affected cells + average cohesion gain (%p)
    function investEffect(scope: "nation" | "border"): { n: number; gain: number } {
      let n = 0, sum = 0;
      for (let c = 0; c < s.n; c++) {
        if (s.owner[c] !== s.playerPolity) continue;
        if (scope === "border" && !isFrontier(c)) continue;
        n++;
        sum += INVEST_DELTA * (1 - s.solidarity[c]);
      }
      return { n, gain: n ? Math.round((sum / n) * 100) : 0 };
    }

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
      // clickable attack targets — drawn as the REGION the attack would actually take (the
      // breakthrough cluster from predictCapture), since conquest happens in chunks, not cells;
      // the dropdown stays as the synced twin
      const tg = document.createElementNS(NS, "g");
      tg.setAttribute("class", "attack-targets");
      for (const target of borderTargets(s)) {
        const cluster = target.capturable ? predictCapture(s, target.cell) : [];
        const cells = cluster.length ? cluster : [target.cell];
        const p = document.createElementNS(NS, "path");
        p.setAttribute("d", cells.map((c) => cellPath(world.grid.polygons[c])).join(""));
        const selected = pendingAction?.type === "attack" && pendingAction.cell === target.cell;
        p.setAttribute("class", `target-cell${target.capturable ? " capturable" : ""}${target.sea ? " sea" : ""}${selected ? " selected" : ""}`);
        p.setAttribute("data-cell", String(target.cell));
        p.setAttribute("data-gain", String(cluster.length));
        // landing zones (across a strait) tinted blue so they read differently from land pushes
        p.setAttribute("fill", !target.capturable ? "rgba(0,0,0,0)" : target.sea ? "rgba(59,116,166,0.24)" : "rgba(63,158,87,0.16)");
        if (selected) { p.setAttribute("stroke", "#2a2118"); p.setAttribute("stroke-width", "1.6"); }
        const tip = document.createElementNS(NS, "title");
        tip.textContent = `${target.sea ? "⛵ " : ""}${target.ownerName} ${target.capturable ? `✓ ×${cluster.length}` : "✗"}`;
        p.appendChild(tip);
        p.addEventListener("click", () => {
          pendingAction = { type: "attack", cell: target.cell };
          renderMap();
          renderActions();
        });
        tg.appendChild(p);
      }
      // clickable found-city sites: the dropdown's top candidates, gold-tinted on the player's own
      // land — click your land to build, click enemy land to attack (no spatial overlap)
      for (const site of foundCityTargets(s).slice(0, 20)) {
        const p = document.createElementNS(NS, "path");
        p.setAttribute("d", cellPath(world.grid.polygons[site.cell]));
        const selected = pendingAction?.type === "foundCity" && pendingAction.cell === site.cell;
        p.setAttribute("class", `site-cell${selected ? " selected" : ""}`);
        p.setAttribute("data-cell", String(site.cell));
        p.setAttribute("fill", "rgba(168,132,44,0.15)");
        if (selected) { p.setAttribute("stroke", "#a8842c"); p.setAttribute("stroke-width", "1.6"); }
        const tip = document.createElementNS(NS, "title");
        tip.textContent = `★ ${(site.sol * 100) | 0}%`;
        p.appendChild(tip);
        p.addEventListener("click", () => {
          pendingAction = { type: "foundCity", cell: site.cell };
          renderMap();
          renderActions();
        });
        tg.appendChild(p);
      }
      g.insertBefore(tg, g.firstChild); // under the front lines (which are pointer-events:none)

      // pending-action preview (Into the Breach-style): paint exactly what the chosen action
      // touches, so "invest frontier" or "peace with X" is visible on the map before you commit
      if (pendingAction?.type === "invest") {
        const cells: number[] = [];
        for (let c = 0; c < s.n; c++) {
          if (s.owner[c] !== s.playerPolity) continue;
          if (pendingAction.scope === "border" && !isFrontier(c)) continue;
          cells.push(c);
        }
        const p = document.createElementNS(NS, "path");
        p.setAttribute("d", cells.map((c) => cellPath(world.grid.polygons[c])).join(""));
        p.setAttribute("class", "preview-invest");
        p.setAttribute("fill", "rgba(230,189,102,0.35)");
        p.setAttribute("pointer-events", "none");
        g.appendChild(p);
      }
      if (pendingAction?.type === "peace") {
        const polity = pendingAction.polity;
        const cells: number[] = [];
        for (let c = 0; c < s.n; c++) if (s.owner[c] === polity) cells.push(c);
        const p = document.createElementNS(NS, "path");
        p.setAttribute("d", cells.map((c) => cellPath(world.grid.polygons[c])).join(""));
        p.setAttribute("class", "preview-peace");
        p.setAttribute("fill", "rgba(91,131,166,0.3)");
        p.setAttribute("pointer-events", "none");
        g.appendChild(p);
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

    // the "what do I do?" fixes: an opening how-to card, a map legend, and a per-turn advice line
    function renderHowto(): void {
      howtoBox.innerHTML = "";
      if (!showHelp || over) return;
      const card = document.createElement("div");
      card.className = "howto controls";
      const lines = ["howto1", "howto2", "howto3", "howto4"]
        .map((k) => `<div class="howto-line">${playT(lang, k)}</div>`).join("");
      card.innerHTML = `<b>${playT(lang, "howtoTitle")}</b>${lines}`;
      const start = document.createElement("button");
      start.className = "howto-start";
      start.textContent = playT(lang, "howtoStart");
      start.addEventListener("click", () => { showHelp = false; renderHowto(); });
      card.appendChild(start);
      howtoBox.appendChild(card);
    }

    function renderLegend(): void {
      const chips: [string, string][] = [
        ["rgba(63,158,87,0.5)", "legendPush"],
        ["rgba(59,116,166,0.55)", "legendSea"],
        ["rgba(168,132,44,0.5)", "legendSite"],
        ["#c0473f", "legendThreat"],
        ["#a8842c", "legendCity"],
      ];
      legend.innerHTML = chips
        .map(([color, key]) => `<span class="legend-chip"><span class="legend-swatch" style="background:${color}"></span>${key === "legendCity" ? "★ " : ""}${playT(lang, key)}</span>`)
        .join("");
    }

    // one contextual hint per turn: turn the numbers into "what should I do now"
    function adviceKey(): string {
      const agg = aggregate(s);
      const avg = agg[s.playerPolity]?.avg ?? 0;
      if (avg < 0.45) return "adviceLowSol";
      const edges = frontEdges(s);
      const threats = edges.filter((e) => e.kind === "threat").length;
      const pushes = edges.length - threats;
      if (threats >= 6 && threats > pushes) return "adviceDefend";
      if (borderTargets(s).filter((t) => t.capturable).length >= 3) return "adviceExpand";
      return "adviceBuild";
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
      const solWord = playT(lang, avg >= 0.55 ? "solStable" : avg >= LOW_COHESION ? "solShaky" : "solDanger");
      const threats = borderTargets(s).length;
      const risk = avg < LOW_COHESION ? ` · ⚠ ${playT(lang, "civilWarRisk")}` : "";
      panel.innerHTML =
        `<b class="play-year">${year}</b> · ${name}` +
        ` · ${cells} ${playT(lang, "cells")} · ${playT(lang, "cohesion")} ${pct}% (${solWord})${risk} · ${playT(lang, "threats")} ${threats}`;
      const stanceRow = document.createElement("span");
      stanceRow.className = "view-toggle";
      for (const st of STANCES) {
        const btn = document.createElement("button");
        btn.textContent = playT(lang, st);
        btn.title = playT(lang, `tip${st[0].toUpperCase()}${st.slice(1)}`); // what the stance DOES
        btn.className = s.stance === st ? "active" : "";
        btn.addEventListener("click", () => { setStance(s, st); renderAll(); });
        stanceRow.appendChild(btn);
      }
      const helpBtn = document.createElement("button");
      helpBtn.className = "help-btn";
      helpBtn.textContent = playT(lang, "help");
      helpBtn.addEventListener("click", () => { showHelp = true; renderHowto(); });
      panel.append(stanceRow, helpBtn, langButton(rerender));
      const advice = document.createElement("div");
      advice.className = "advice";
      advice.textContent = playT(lang, adviceKey());
      panel.appendChild(advice);
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
        const gain = target.capturable ? ` ✓ ×${predictCapture(s, target.cell).length}` : " ✗";
        opt.textContent = `${target.sea ? "⛵ " : ""}${target.ownerName} (cell ${target.cell})${gain}`;
        sel.appendChild(opt);
      }

      const inv = document.createElement("select");
      inv.className = "invest-select";
      for (const [value, key] of [["", "investPlaceholder"], ["nation", "investRealmOpt"], ["border", "investFrontierOpt"]] as const) {
        const opt = document.createElement("option");
        opt.value = value;
        if (value === "") opt.textContent = playT(lang, key);
        else {
          // Civ-style numeric preview: what this option actually does, in the label itself
          const fx = investEffect(value);
          opt.textContent = `${playT(lang, key)} (${fx.n} ${playT(lang, "cells")}, +${fx.gain}%p)`;
        }
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

      // what each action does + when to use it, on hover
      sel.title = playT(lang, "tipAttack");
      inv.title = playT(lang, "tipInvest");
      fnd.title = playT(lang, "tipFound");
      pce.title = playT(lang, "tipPeace");

      // one action per turn: picking in any select clears the other three
      const selects = [sel, inv, fnd, pce];
      const clearOthers = (keep: HTMLSelectElement) => {
        for (const other of selects) if (other !== keep) other.value = "";
      };
      sel.addEventListener("change", () => {
        pendingAction = sel.value ? { type: "attack", cell: Number(sel.value) } : null;
        if (pendingAction) clearOthers(sel);
        status.textContent = label();
        renderMap(); // show the pick on the map
      });
      inv.addEventListener("change", () => {
        pendingAction = inv.value ? { type: "invest", scope: inv.value as "nation" | "border" } : null;
        if (pendingAction) clearOthers(inv);
        status.textContent = label();
        renderMap();
      });
      fnd.addEventListener("change", () => {
        pendingAction = fnd.value ? { type: "foundCity", cell: Number(fnd.value) } : null;
        if (pendingAction) clearOthers(fnd);
        status.textContent = label();
        renderMap();
      });
      pce.addEventListener("change", () => {
        pendingAction = pce.value ? { type: "peace", polity: Number(pce.value) } : null;
        if (pendingAction) clearOthers(pce);
        status.textContent = label();
        renderMap();
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
        dilemma = offerDilemma(s); // an unanswered card expires with the decade
        renderAll();
      });
      // restore the pending pick into its select (map clicks and re-renders keep the UI in sync)
      if (pendingAction?.type === "attack") sel.value = String(pendingAction.cell);
      else if (pendingAction?.type === "invest") inv.value = pendingAction.scope;
      else if (pendingAction?.type === "foundCity") fnd.value = String(pendingAction.cell);
      else if (pendingAction?.type === "peace") pce.value = String(pendingAction.polity);
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

    // Reigns-style card: a free two-choice event aimed at the player (separate from the action slot)
    function renderDilemma(): void {
      dilemmaBox.innerHTML = "";
      if (!dilemma || over) { dilemmaBox.style.display = "none"; return; }
      dilemmaBox.style.display = "";
      const d = playDilemma(lang, dilemma.code, dilemma.data);
      const title = document.createElement("span");
      title.className = "dilemma-title";
      title.textContent = `❔ ${d.title}`;
      dilemmaBox.appendChild(title);
      for (const [key, label] of [["a", d.a], ["b", d.b]] as const) {
        const btn = document.createElement("button");
        btn.className = `dilemma-${key}`;
        btn.textContent = label;
        btn.addEventListener("click", () => {
          const out = resolveDilemma(s, dilemma!, key);
          dilemma = null;
          appendLog(`❔ ${playDilemmaOutcome(lang, out.code, out.data)}`, true);
          renderAll();
        });
        dilemmaBox.appendChild(btn);
      }
    }

    function renderAll(): void { renderMap(); renderPanel(); renderActions(); renderDilemma(); renderHowto(); renderLegend(); }

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
      // the payoff artifact: download your reign as a readable chronicle (win or lose)
      const exp = document.createElement("button");
      exp.className = "reign-export";
      exp.textContent = playT(lang, "reignExport");
      exp.addEventListener("click", () => {
        const md = reignChronicle(s, world.name, lang);
        const nation = s.polities[s.playerPolity].name.replace(/[^\p{L}\p{N}]+/gu, "_");
        downloadBlob(`${nation}_reign.md`, new Blob([md], { type: "text/markdown" }));
      });
      banner.appendChild(exp);
      side.insertBefore(banner, log);
    }

    function end(defeated: boolean, conqueror = ""): void {
      over = true;
      defeatedFlag = defeated;
      defeatCause = conqueror;
      dilemma = null;
      actions.innerHTML = "";
      renderPanel();
      renderDilemma();
      renderHowto();
      renderBanner();
    }

    dilemma = offerDilemma(s); // sometimes the reign opens with a question
    renderAll();
    appendLog(playRuleIntro(lang, s.polities[playerPolity].name));
  }

  renderPicker();
}
