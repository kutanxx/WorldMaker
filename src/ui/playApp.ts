import { generateWorld } from "../engine/world";
import { DEFAULT_PARAMS } from "../types/world";
import { aggregate, YEARS_PER_TICK, TICKS, CONQUEST_SOL } from "../engine/historySim";
import { initPlaySim, playTurn, setStance, scorecard, victoryProgress, PROSPER_CITIES, PROSPER_STREAK } from "../engine/playSim";
import type { Stance } from "../engine/historySim";
import { borderTargets, frontEdges, foundCityTargets, hostileNeighbors, predictCapture, INVEST_DELTA, type Action } from "../engine/intervention";
import { OCEAN } from "../engine/terrain";
import { sharedEdge } from "../engine/borders";
import { cellPath } from "./svgPaths";
import { renderWorld } from "./svgWorldRenderer";
import { reignChronicle } from "../engine/reign";
import { downloadBlob } from "./export";
import { politicalLayer } from "./politicalLayer";
import { t, playT, playYear, playLog, playRuleIntro, playFell, playStats, playDelta, playDefeatCause, playDilemma, playDilemmaOutcome, playDilemmaFx, type Lang } from "./i18n";
import { offerDilemma, resolveDilemma, previewDilemma, bestRaidTarget, type Dilemma } from "../engine/dilemma";
import { computeStanding, type Standing } from "../engine/standing";
import { PLAYER_COLOR } from "./nationPalette";
import { deconflictLabels } from "./deconflict";
import { randomSeed } from "./urlState";

const STANCES: Stance[] = ["aggressive", "defensive", "internal"];

type VictoryKind = "conquest" | "prosperity" | "endurance" | "defeat";

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
    let momentum: { dCells: number; dCohesionDir: -1 | 0 | 1; lost: number } | null = null;
    let prosperStreak = 0;

    const howtoBox = document.createElement("div");
    howtoBox.className = "howto-slot";
    const panel = document.createElement("div");
    panel.className = "play-panel controls";
    const goals = document.createElement("div");
    goals.className = "goals";
    const dilemmaBox = document.createElement("div");
    dilemmaBox.className = "dilemma controls";
    dilemmaBox.style.display = "none";
    const stage = document.createElement("div");
    stage.className = "stage";
    const actions = document.createElement("div");
    actions.className = "play-actions controls";
    const log = document.createElement("div");
    log.className = "chronicle";
    // vertical stack: a thin standing strip on top, then the big map, the dilemma card, the slim
    // command bar, and the log — so the map gets the full column width (user feedback: map too small)
    const col = document.createElement("div");
    col.className = "play-col";
    col.append(panel, goals, stage, dilemmaBox, actions, log);
    root.append(howtoBox, col);

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

    // projected effect of the player's OWN pending action on the meters — read-only.
    // Deliberately excludes the world's response (bots move in the same advance); the
    // .fx-label "your action" scopes the claim so the preview never reads as a lie.
    function actionFx(): { cells?: number; coh?: number; threat?: "up" | "down" } | null {
      if (!pendingAction) return null;
      if (pendingAction.type === "attack") {
        const k = predictCapture(s, pendingAction.cell).length || 1;
        let n = 0, sum = 0;
        for (let c = 0; c < s.n; c++) if (s.owner[c] === s.playerPolity) { n++; sum += s.solidarity[c]; }
        const dCoh = n ? ((sum + k * CONQUEST_SOL) / (n + k) - sum / n) * 100 : 0; // raw %p, rounded at display
        const breaks = (s.truces.get(s.owner[pendingAction.cell]) ?? 0) > s.tick;
        return { cells: k, coh: dCoh, ...(breaks ? { threat: "up" as const } : {}) };
      }
      if (pendingAction.type === "invest") return { coh: investEffect(pendingAction.scope).gain };
      if (pendingAction.type === "peace") return { threat: "down" };
      return null; // foundCity — the goals line carries its hint (renderGoals)
    }
    function fxBadge(text: string, good: boolean): HTMLElement {
      const b = document.createElement("span");
      b.className = `fx-badge ${good ? "good" : "bad"}`;
      b.textContent = text;
      return b;
    }

    function renderMap(): void {
      mapFrame.innerHTML = "";
      const svg = renderWorld(world, "political", s.economicZones.map((z) => z.cell), lang);
      const slot = svg.querySelector(".political-slot") as SVGGElement;
      slot.replaceChildren(politicalLayer(world.grid, s.owner, s.polities, { fills: true, labels: true, legend: false, playerPolity: s.playerPolity, playerColor: PLAYER_COLOR }));
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
      // the command-bar status line is the synced twin
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
          renderPending();
        });
        tg.appendChild(p);
      }
      // clickable found-city sites: the best candidates, gold-tinted on the player's own
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
          renderPending();
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
      // capital crown — only while the player still holds the seat
      const cap = s.capitals[s.playerPolity];
      if (s.owner[cap] === s.playerPolity) {
        const crown = document.createElementNS(NS, "text");
        crown.setAttribute("x", String(world.grid.points[cap * 2]));
        crown.setAttribute("y", String(world.grid.points[cap * 2 + 1]));
        crown.setAttribute("class", "capital-crown");
        crown.setAttribute("text-anchor", "middle");
        crown.setAttribute("font-size", "13");
        crown.setAttribute("pointer-events", "none");
        crown.textContent = "♛";
        g.appendChild(crown);
      }
      slot.parentNode!.insertBefore(g, slot.nextSibling); // above political fills, below markers
      mapFrame.appendChild(svg);
      deconflictLabels(svg); // hide colliding lower-priority labels once the map is mounted
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

    // the advisor's one consistent semantic: SELECT (pendingAction + map preview), never execute.
    // adviceDefend is the labeled exception — stance is an instant free toggle, not an action.
    function adviceAction(key: string): { stance?: boolean; run: () => void } | null {
      if (key === "adviceLowSol")
        return { run: () => { pendingAction = { type: "invest", scope: "nation" }; renderPending(); } };
      if (key === "adviceDefend")
        return { stance: true, run: () => { setStance(s, "defensive"); renderAll(); } };
      if (key === "adviceExpand") {
        const t = bestRaidTarget(s); // same pick the raiders raid uses
        return t ? { run: () => { pendingAction = { type: "attack", cell: t.cell }; renderPending(); } } : null;
      }
      const site = foundCityTargets(s)[0]; // sorted best-first by cohesion
      return site ? { run: () => { pendingAction = { type: "foundCity", cell: site.cell }; renderPending(); } } : null;
    }

    function meterRow(cls: string, label: string, value: string, state: string, tooltip: string): HTMLElement {
      const row = document.createElement("div");
      row.className = `meter ${cls} ${state}`;
      if (tooltip) row.title = tooltip;
      const l = document.createElement("span");
      l.className = tooltip ? "meter-label hint" : "meter-label";
      l.textContent = label;
      const v = document.createElement("span"); v.className = "meter-value"; v.textContent = value;
      row.append(l, v);
      return row;
    }

    function momentumText(): string {
      if (!momentum) return playT(lang, "firstTurn");
      const d = momentum.dCells;
      const cellArrow = d > 0 ? `▲+${d}` : d < 0 ? `▼${-d}` : "–";
      const dir = momentum.dCohesionDir;
      const cohArrow = dir > 0 ? "▲" : dir < 0 ? "▼" : "–";
      const lostClause = momentum.lost > 0 ? ` · ${momentum.lost}${playT(lang, "cellsLost")}` : "";
      return `${playT(lang, "thisTurn")} · ${playT(lang, "strength")} ${cellArrow}${playT(lang, "cells")}` +
        ` · ${playT(lang, "cohesion")} ${cohArrow}${lostClause}`;
    }

    function renderPanel(): void {
      const year = playYear(lang, s.tick * YEARS_PER_TICK);
      const name = s.polities[s.playerPolity].name;
      // a fallen realm has no standing to speak of — the scorecard banner tells that story
      if (!s.alive[s.playerPolity]) {
        panel.innerHTML = `<b class="play-year">${year}</b> · ${name} — ${playT(lang, "fallen")}`;
        panel.appendChild(langButton(rerender));
        return;
      }
      const st: Standing = computeStanding(s);
      panel.innerHTML = `<b class="play-year">${year}</b> · ${name}`;

      const chip = document.createElement("span");
      chip.className = "nation-chip";
      const sw = document.createElement("span");
      sw.className = "nation-swatch";
      sw.style.background = PLAYER_COLOR;
      chip.append(sw, document.createTextNode(` ${playT(lang, "yourNation")}`)); // name is in the header; chip carries the colour
      panel.insertBefore(chip, panel.firstChild);

      // ① momentum headline — the real new signal
      const mo = document.createElement("div");
      mo.className = "momentum";
      mo.textContent = momentumText();
      panel.appendChild(mo);

      // ② two health meters (context the momentum moves within)
      const meters = document.createElement("div");
      meters.className = "standing";
      const strengthWord = playT(lang,
        st.strength === "strong" ? "strengthStrong" : st.strength === "weak" ? "strengthWeak" : "strengthEven");
      const strengthVal = `${strengthWord} (${st.cells} ${playT(lang, "vs")} ${Math.round(st.rivalAvgCells)})`;
      const strengthRow = meterRow("meter-strength", playT(lang, "strength"), strengthVal, st.strength, playT(lang, "tipStrength"));
      meters.appendChild(strengthRow);
      const cohWord = playT(lang,
        st.cohesionState === "stable" ? "solStable" : st.cohesionState === "shaky" ? "solShaky" : "solDanger");
      const warn = st.cohesionState === "danger" ? "⚠ " : "";
      // only the danger state gets an inline consequence, and only the universally-true one
      // (low cohesion = weaker in battle). The civil-war detail lives in the tooltip, since it is
      // large-realm-only (>=220 cells & avg<0.42) and would be false for small realms.
      const weakTag = st.cohesionState === "danger" ? ` · ${playT(lang, "cohWeak")}` : "";
      const cohVal = `${warn}${(st.cohesion * 100) | 0}% (${cohWord}${weakTag})`;
      const cohRow = meterRow("meter-cohesion", playT(lang, "cohesion"), cohVal, st.cohesionState, playT(lang, "tipCohesion"));
      meters.appendChild(cohRow);
      panel.appendChild(meters);

      const fx = actionFx();
      if (fx) {
        if (fx.cells) strengthRow.appendChild(fxBadge(`▲+${fx.cells}${playT(lang, "cells")}`, true));
        if (fx.coh) {
          // direction always shows; the magnitude only when it wouldn't round to 0 (tiny attacks on a
          // large realm shift the average by <0.1%p — "▼" alone is honest, "▼−0%p" is nonsense)
          const up = fx.coh > 0;
          const mag = Math.round(Math.abs(fx.coh) * 10) / 10;
          cohRow.appendChild(fxBadge(`${up ? "▲" : "▼"}${mag >= 0.1 ? `${up ? "+" : "−"}${mag}%p` : ""}`, up));
        }
        const label = document.createElement("span");
        label.className = "fx-label";
        label.textContent = playT(lang, "fxOwn");
        meters.appendChild(label);
      }

      // ③ threat line
      const threat = document.createElement("div");
      threat.className = "threat-line hint";
      threat.title = playT(lang, "tipThreat");
      const truceStr = st.truceCount > 0 ? ` · ${playT(lang, "truce")} ${st.truceCount}` : "";
      threat.textContent = `${playT(lang, "border")} ${st.borderPolities}${truceStr}`;
      if (fx?.threat === "up") threat.appendChild(fxBadge(`▲ ${playT(lang, "fxTruceBreak")}`, false));
      if (fx?.threat === "down") threat.appendChild(fxBadge(`▼ ${playT(lang, "truce")} +1`, true)); // spec: 위협 ▼ 휴전 +1
      panel.appendChild(threat);

      // stance levers + help + language (unchanged behaviour)
      const stanceRow = document.createElement("span");
      stanceRow.className = "view-toggle";
      for (const st2 of STANCES) {
        const btn = document.createElement("button");
        btn.textContent = playT(lang, st2);
        btn.title = playT(lang, `tip${st2[0].toUpperCase()}${st2.slice(1)}`);
        btn.className = s.stance === st2 ? "active" : "";
        btn.addEventListener("click", () => { setStance(s, st2); renderAll(); });
        stanceRow.appendChild(btn);
      }
      const helpBtn = document.createElement("button");
      helpBtn.className = "help-btn";
      helpBtn.textContent = playT(lang, "help");
      helpBtn.addEventListener("click", () => { showHelp = true; renderHowto(); });
      panel.append(stanceRow, helpBtn, langButton(rerender));

      // per-turn advice line (kept)
      const advice = document.createElement("div");
      advice.className = "advice";
      const key = adviceKey();
      advice.textContent = playT(lang, key);
      const act = adviceAction(key);
      if (act) {
        const b = document.createElement("button");
        b.className = "advise-act";
        b.textContent = playT(lang, act.stance ? "adviseStance" : "adviseAct");
        b.addEventListener("click", act.run);
        advice.appendChild(b);
      }
      panel.appendChild(advice);
    }

    function renderGoals(): void {
      if (over || !s.alive[s.playerPolity]) { goals.textContent = ""; return; }
      const vp = victoryProgress(s);
      goals.textContent =
        `${playT(lang, "goals")}: ⚔ ${playT(lang, "goalRivals")} ${vp.rivalsLeft}` +
        ` · 🏘 ${vp.cities}/${PROSPER_CITIES} ${vp.cohesionOk ? "✓" : "✗"} ${prosperStreak}/${PROSPER_STREAK}` +
        ` · 👑 ${vp.year}/500`;
      if (pendingAction?.type === "foundCity") {
        goals.textContent += ` · 🏘 ${playT(lang, "fxCityNext").replace("{n}", String(vp.cities + 1))}`;
      }
    }

    function renderActions(): void {
      actions.innerHTML = "";
      if (over) return; // a fallen realm has no actions (the banner tells the story)

      // invest = a 2-segment control (전국 | 국경), each showing its numeric effect — not a dropdown
      const investSeg = document.createElement("span");
      investSeg.className = "view-toggle invest-seg";
      for (const scope of ["nation", "border"] as const) {
        const fx = investEffect(scope);
        const b = document.createElement("button");
        b.textContent = `💰 ${playT(lang, scope === "border" ? "investFrontierOpt" : "investRealmOpt")} (+${fx.gain}%p)`;
        b.title = playT(lang, "tipInvest");
        b.className = pendingAction?.type === "invest" && pendingAction.scope === scope ? "active" : "";
        b.addEventListener("click", () => {
          pendingAction = { type: "invest", scope };
          renderPending();
        });
        investSeg.appendChild(b);
      }

      // peace = the one remaining select, clearly labelled (not one of four tiny ones)
      const pce = document.createElement("select");
      pce.className = "peace-select";
      pce.title = playT(lang, "tipPeace");
      const pceNone = document.createElement("option");
      pceNone.value = ""; pceNone.textContent = playT(lang, "peacePlaceholder");
      pce.appendChild(pceNone);
      for (const h of hostileNeighbors(s)) {
        const opt = document.createElement("option");
        opt.value = String(h.id);
        opt.textContent = h.trucedUntil > s.tick ? `${h.name} ✓` : h.name;
        pce.appendChild(opt);
      }
      if (pendingAction?.type === "peace") pce.value = String(pendingAction.polity);
      pce.addEventListener("change", () => {
        pendingAction = pce.value ? { type: "peace", polity: Number(pce.value) } : null;
        renderPending();
      });

      // pass clears any pending action
      const pass = document.createElement("button");
      pass.className = "btn-pass";
      pass.textContent = playT(lang, "pass");
      pass.addEventListener("click", () => { pendingAction = null; renderPending(); });

      const advance = document.createElement("button");
      advance.className = "btn-advance";
      // the button states the turn — Civ's Next Turn as the single anchor (replaces .action-status)
      const summary = () =>
        !pendingAction ? ""
          : pendingAction.type === "attack" ? ` — ⚔ +${predictCapture(s, pendingAction.cell).length || 1}${playT(lang, "cells")}`
            : pendingAction.type === "foundCity" ? ` — ${playT(lang, "advFound")}`
              : pendingAction.type === "peace" ? ` — ${playT(lang, "advPeace")}`
                : ` — 💰 ${playT(lang, pendingAction.scope === "border" ? "investFrontierOpt" : "investRealmOpt")} +${investEffect(pendingAction.scope).gain}%p`;
      advance.textContent = playT(lang, "advance") + summary();
      if (dilemma) {
        const dot = document.createElement("span");
        dot.className = "advance-alert";
        dot.textContent = " ❗";
        dot.title = playT(lang, "advanceAlertTip");
        advance.appendChild(dot);
      }
      // --- BEGIN verbatim advance handler (do not modify) ---
      advance.addEventListener("click", () => {
        const before = Int32Array.from(s.owner);
        const cohBefore = aggregate(s)[s.playerPolity]?.avg ?? 0;
        const r = playTurn(s, pendingAction);
        pendingAction = null;
        let gained = 0, lost = 0;
        for (let c = 0; c < s.n; c++) {
          const was = before[c] === s.playerPolity, now = s.owner[c] === s.playerPolity;
          if (now && !was) gained++; else if (was && !now) lost++;
        }
        const cohAfter = aggregate(s)[s.playerPolity]?.avg ?? 0;
        const dir: -1 | 0 | 1 = cohAfter > cohBefore + 0.005 ? 1 : cohAfter < cohBefore - 0.005 ? -1 : 0;
        momentum = { dCells: gained - lost, dCohesionDir: dir, lost };
        appendLog(playDelta(lang, r.year, gained, lost));
        const msg = playLog(lang, r.actionCode, r.actionData);
        if (msg) appendLog(`— ${msg}`);
        for (const e of r.events) {
          const hl = isPlayerEvent(e);
          appendLog(hl ? `${HEADLINE_ICON[e.type] ?? "•"} ${e.text}` : e.text, hl);
        }
        const vp = victoryProgress(s);
        prosperStreak = vp.prosperityGate ? prosperStreak + 1 : 0;
        const kind: VictoryKind | null =
          !s.alive[s.playerPolity] ? "defeat"
            : vp.conquest ? "conquest"
              : prosperStreak >= PROSPER_STREAK ? "prosperity"
                : s.tick >= TICKS ? "endurance"
                  : null;
        if (kind) {
          const conq = r.events.find((e) => e.type === "conquer" && e.otherId === s.playerPolity);
          return end(kind, kind === "defeat" && conq ? s.polities[conq.polityId].name : "");
        }
        dilemma = offerDilemma(s); // an unanswered card expires with the decade
        renderAll();
      });
      // --- END verbatim advance handler ---

      actions.append(investSeg, pce, pass, advance);
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
        const fx = document.createElement("span");
        fx.className = "choice-fx";
        fx.textContent = playDilemmaFx(lang, previewDilemma(s, dilemma, key));
        btn.appendChild(fx); // inside the button: the whole card stays one big click target
        btn.addEventListener("click", () => {
          const out = resolveDilemma(s, dilemma!, key);
          dilemma = null;
          appendLog(`❔ ${playDilemmaOutcome(lang, out.code, out.data)}`, true);
          renderAll();
        });
        dilemmaBox.appendChild(btn);
      }
    }

    function renderAll(): void { renderMap(); renderPanel(); renderGoals(); renderActions(); renderDilemma(); renderHowto(); renderLegend(); }

    // a picked-but-uncommitted action must repaint the meters/goals too, not just map+bar
    function renderPending(): void { renderMap(); renderPanel(); renderGoals(); renderActions(); }

    // re-render the live screen in the current language (keeps the accumulated log)
    function rerender(): void {
      if (over) { renderMap(); renderPanel(); renderBanner(); } else renderAll();
    }

    let victoryKind: VictoryKind = "endurance";
    let defeatCause = "";
    function renderBanner(): void {
      root.querySelector(".stub")?.remove();
      const sc = scorecard(s);
      const banner = document.createElement("div");
      banner.className = "stub";
      const head =
        victoryKind === "defeat" ? playFell(lang, sc.survivedYears)
          : victoryKind === "conquest" ? playT(lang, "winConquest")
            : victoryKind === "prosperity" ? playT(lang, "winProsperity")
              : playT(lang, "endured");
      const rankText = sc.rank > 0 ? `${sc.rank} / ${sc.nations}` : "—";
      const cause = victoryKind === "defeat" && defeatCause ? ` ${playDefeatCause(lang, defeatCause)}` : "";
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
      const restart = document.createElement("div");
      restart.className = "restart-row";
      const again = document.createElement("button");
      again.className = "btn-play-again";
      again.textContent = playT(lang, "playAgain");
      again.addEventListener("click", renderPicker); // same world, choose a nation again
      const fresh = document.createElement("button");
      fresh.className = "btn-new-world";
      fresh.textContent = playT(lang, "newWorld");
      fresh.addEventListener("click", () => {
        location.hash = `seed=${randomSeed()}`; // a fresh seed, so the reload builds a new world
        location.reload();
      });
      restart.append(again, fresh);
      banner.appendChild(restart);
      col.insertBefore(banner, log);
    }

    function end(kind: VictoryKind, cause = ""): void {
      over = true;
      victoryKind = kind;
      defeatCause = cause;
      dilemma = null;
      actions.innerHTML = "";
      renderPanel();
      renderGoals();
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
