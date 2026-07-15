// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { createPlayApp } from "./playApp";
import { hashStringToSeed } from "../engine/rng";
import { dailyName } from "./daily";
import { PLAYER_COLOR } from "./nationPalette";
import { recordReign } from "./legacy";

describe("playApp", () => {
  it("nation picker labels each realm with a difficulty (biggest=easy, smallest=hard)", () => {
    const root = document.createElement("div");
    createPlayApp(root, 1);
    const subs = [...root.querySelectorAll(".nation-choice .choice-sub")].map((e) => e.textContent || "");
    expect(subs.length).toBeGreaterThan(2);
    expect(subs[0]).toMatch(/easy/i);                 // biggest nation first (sorted desc)
    expect(subs[subs.length - 1]).toMatch(/hard/i);   // smallest last
  });

  it("shows a nation picker, then mounts the play screen on selection", () => {
    const root = document.createElement("div");
    createPlayApp(root, 1);
    const choices = root.querySelectorAll(".nation-choice");
    expect(choices.length).toBeGreaterThan(0);
    (choices[0] as HTMLButtonElement).click();
    expect(root.querySelector("svg.world")).not.toBeNull();     // live map
    expect(root.querySelector(".play-panel")).not.toBeNull();   // nation panel
    expect(root.querySelector(".action-status")).toBeNull(); // folded into the advance button
    expect(root.querySelector(".btn-advance")).not.toBeNull();  // advance year
  });

  it("advancing a year updates the year readout", () => {
    const root = document.createElement("div");
    createPlayApp(root, 1);
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    const yearBefore = root.querySelector(".play-year")!.textContent;
    (root.querySelector(".btn-advance") as HTMLButtonElement).click();
    expect(root.querySelector(".play-year")!.textContent).not.toBe(yearBefore);
  });

  it("draws a colored front line on the map", () => {
    const root = document.createElement("div");
    createPlayApp(root, 1);
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    const front = root.querySelector(".front");
    expect(front).not.toBeNull();
    expect(front!.querySelectorAll("line").length).toBeGreaterThan(0);
  });

  it("toggles the play screen to Korean", () => {
    const saved = localStorage.getItem("wm:lang");
    try {
      const root = document.createElement("div");
      createPlayApp(root, 1);
      (root.querySelector(".nation-choice") as HTMLButtonElement).click();
      const toggle = root.querySelector(".lang-toggle") as HTMLButtonElement;
      expect(toggle).not.toBeNull();
      toggle.click();
      const panel = root.querySelector(".play-panel")!.textContent!;
      expect(panel).toContain("년");        // Korean year
      expect(panel).toContain("안정도");      // Korean stability (metric)
      expect((root.querySelector(".btn-advance") as HTMLButtonElement).textContent).toContain("다음 해");
    } finally {
      if (saved === null) localStorage.removeItem("wm:lang");
      else localStorage.setItem("wm:lang", saved);
    }
  });

  it("neighbor chips are the peace surface; picking found-city then invest shares one pending action", () => {
    const root = document.createElement("div");
    createPlayApp(root, 1);
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    expect(root.querySelectorAll(".neighbor-chip").length).toBeGreaterThan(0);
    // picking a found-city site on the map, then invest, replaces the pending pick (one action per turn)
    const site = root.querySelector(".site-cell") as SVGPathElement;
    site.dispatchEvent(new Event("click", { bubbles: true }));
    expect((root.querySelector(".btn-advance") as HTMLElement).textContent).toContain("🏘");
    const investBtn = root.querySelector(".invest-seg button") as HTMLButtonElement;
    investBtn.click();
    expect((root.querySelector(".btn-advance") as HTMLElement).textContent).toContain("💰");
    expect(root.querySelector(".site-cell.selected")).toBeNull(); // the found pick is gone
  });

  it("founding a city logs it and draws a ★ marker on the map", () => {
    const root = document.createElement("div");
    createPlayApp(root, 1);
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    const site = root.querySelector(".site-cell") as SVGPathElement;
    site.dispatchEvent(new Event("click", { bubbles: true }));
    (root.querySelector(".btn-advance") as HTMLButtonElement).click();
    const rows = [...root.querySelectorAll(".chronicle-event")].map((e) => e.textContent || "");
    expect(rows.some((t) => /Founded the city of/.test(t))).toBe(true);
    expect(root.querySelector(".founded-city")).not.toBeNull();
  });

  it("suing for peace logs the truce", () => {
    const root = document.createElement("div");
    createPlayApp(root, 1);
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    (root.querySelector(".neighbor-chip") as HTMLElement).click();
    (root.querySelector(".btn-advance") as HTMLButtonElement).click();
    const rows = [...root.querySelectorAll(".chronicle-event")].map((e) => e.textContent || "");
    expect(rows.some((t) => /Made peace with/.test(t))).toBe(true);
  });

  it("map shows clickable attack-target cells; clicking one picks the attack and updates the status", () => {
    const root = document.createElement("div");
    createPlayApp(root, 1);
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    const targets = root.querySelectorAll(".target-cell");
    expect(targets.length).toBeGreaterThan(0);
    (targets[0] as SVGPathElement).dispatchEvent(new Event("click", { bubbles: true }));
    expect((root.querySelector(".btn-advance") as HTMLElement).textContent).toContain("⚔");
    // the picked cell is marked selected on the map
    expect(root.querySelector(".target-cell.selected")).not.toBeNull();
  });

  it("capturable targets are drawn as the whole region the attack would take (data-gain)", () => {
    const root = document.createElement("div");
    createPlayApp(root, 1);
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    const caps = [...root.querySelectorAll(".target-cell.capturable")];
    expect(caps.length).toBeGreaterThan(0);
    for (const c of caps) expect(Number(c.getAttribute("data-gain"))).toBeGreaterThanOrEqual(1);
    // a breakthrough region is one path made of several cell subpaths (multiple "M" commands)
    const multi = caps.find((c) => Number(c.getAttribute("data-gain")) > 1);
    if (multi) {
      expect((multi.getAttribute("d")!.match(/M/g) || []).length).toBe(Number(multi.getAttribute("data-gain")));
      // the tooltip advertises the capture-size multiplier (e.g. "✓ ×3")
      expect(multi.querySelector("title")!.textContent).toMatch(/×\d/);
    }
  });

  it("shows clickable found-city sites on the map; clicking one picks foundCity", () => {
    const root = document.createElement("div");
    createPlayApp(root, 1);
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    const sites = root.querySelectorAll(".site-cell");
    expect(sites.length).toBeGreaterThan(0);
    expect(sites.length).toBeLessThanOrEqual(20);
    (sites[0] as SVGPathElement).dispatchEvent(new Event("click", { bubbles: true }));
    expect((root.querySelector(".btn-advance") as HTMLElement).textContent).toContain("🏘");
    expect(root.querySelector(".site-cell.selected")).not.toBeNull();
    // advancing founds the city there
    (root.querySelector(".btn-advance") as HTMLButtonElement).click();
    const rows = [...root.querySelectorAll(".chronicle-event")].map((e) => e.textContent || "");
    expect(rows.some((t) => /Founded the city of/.test(t))).toBe(true);
  });

  it("opens with a how-to-rule card that dismisses, and can be reopened from the panel", () => {
    const root = document.createElement("div");
    createPlayApp(root, 1);
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    const howto = root.querySelector(".howto");
    expect(howto).not.toBeNull();
    expect(howto!.textContent).toMatch(/500/); // the goal is stated
    for (let step = 0; step < 3; step++) (root.querySelector(".howto-next") as HTMLButtonElement).click();
    (root.querySelector(".howto-start") as HTMLButtonElement).click();
    expect(root.querySelector(".howto")).toBeNull();
    (root.querySelector(".help-btn") as HTMLButtonElement).click(); // reopen
    expect(root.querySelector(".howto")).not.toBeNull();
  });

  it("the how-to opens as a stepper: one line per step, Start on the last, '?' shows the full card", () => {
    const root = document.createElement("div");
    createPlayApp(root, 1);
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    const lines = () => root.querySelectorAll(".howto-line").length;
    expect(lines()).toBe(1); // step 1 of 4, not the wall of text
    for (let step = 0; step < 3; step++) {
      const next = root.querySelector(".howto-next") as HTMLButtonElement;
      expect(next).not.toBeNull();
      next.click();
      expect(lines()).toBe(1);
    }
    expect(root.querySelector(".howto-next")).toBeNull(); // last step: Start replaces Next
    (root.querySelector(".howto-start") as HTMLButtonElement).click();
    expect(root.querySelector(".howto")).toBeNull();
    (root.querySelector(".help-btn") as HTMLButtonElement).click(); // reopen = reference mode
    expect(lines()).toBe(4);
  });

  it("shows a map legend and a contextual advice line every turn", () => {
    const root = document.createElement("div");
    createPlayApp(root, 1);
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    const legend = root.querySelector(".play-legend");
    expect(legend).not.toBeNull();
    expect(legend!.querySelectorAll(".legend-chip").length).toBeGreaterThanOrEqual(4);
    const advice = root.querySelector(".advice");
    expect(advice).not.toBeNull();
    expect((advice!.textContent || "").length).toBeGreaterThan(4);
    (root.querySelector(".btn-advance") as HTMLButtonElement).click();
    expect(root.querySelector(".advice")).not.toBeNull(); // refreshed each turn
  });

  it("the advice line's button selects a pending action or stance — it never advances the turn", () => {
    const root = document.createElement("div");
    createPlayApp(root, 1);
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    const year = root.querySelector(".play-year")!.textContent;
    const act = root.querySelector(".advise-act") as HTMLButtonElement | null;
    expect(act).not.toBeNull(); // seed-1 turn-0 advice is actionable (per probe)
    const advBefore = (root.querySelector(".btn-advance") as HTMLElement).textContent;
    const stanceBefore = (root.querySelector(".view-toggle button.active") as HTMLElement)?.textContent;
    act!.click();
    expect(root.querySelector(".play-year")!.textContent).toBe(year); // did NOT advance
    const advAfter = (root.querySelector(".btn-advance") as HTMLElement).textContent;
    const stanceAfter = (root.querySelector(".view-toggle button.active") as HTMLElement)?.textContent;
    expect(advAfter !== advBefore || stanceAfter !== stanceBefore).toBe(true); // something got selected
  });

  it("stance buttons carry explanatory tooltips and the panel names the cohesion state", () => {
    const root = document.createElement("div");
    createPlayApp(root, 1);
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    const stanceBtns = [...root.querySelectorAll(".play-panel .view-toggle button")];
    expect(stanceBtns.length).toBe(3);
    for (const b of stanceBtns) expect((b.getAttribute("title") || "").length).toBeGreaterThan(4);
    expect(root.querySelector(".play-panel")!.textContent).toMatch(/steady|shaky|critical/);
  });

  it("invest segments state their real effect (cohesion gain), and carry tooltips alongside peace", () => {
    const root = document.createElement("div");
    createPlayApp(root, 1);
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    const btns = [...root.querySelectorAll(".invest-seg button")];
    expect(btns.length).toBe(2);
    const labels = btns.map((b) => b.textContent || "");
    expect(labels.some((t) => /\+\d+%p/.test(t))).toBe(true); // numeric preview
    for (const b of btns) expect((b.getAttribute("title") || "").length).toBeGreaterThan(8);
    expect((((root.querySelector(".neighbor-chip") as HTMLElement) || { title: "" }).title || "").length).toBeGreaterThan(8);
  });

  it("picking invest or peace paints the affected area on the map (action preview)", () => {
    const root = document.createElement("div");
    createPlayApp(root, 1);
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    const investBtns = root.querySelectorAll(".invest-seg button");
    (investBtns[1] as HTMLButtonElement).click(); // border scope (2nd segment)
    expect(root.querySelector(".preview-invest")).not.toBeNull();
    (root.querySelector(".neighbor-chip") as HTMLElement).click();
    expect(root.querySelector(".preview-invest")).toBeNull(); // previews are exclusive
    expect(root.querySelector(".preview-peace")).not.toBeNull();
  });

  it("dilemma cards appear during a reign; answering one logs the outcome and clears the card", () => {
    const root = document.createElement("div");
    createPlayApp(root, 1);
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    let answered = false;
    for (let i = 0; i < 50 && !answered; i++) {
      const choice = root.querySelector(".dilemma-a") as HTMLButtonElement | null;
      if (choice) {
        const rowsBefore = root.querySelectorAll(".chronicle-event").length;
        choice.click();
        expect(root.querySelectorAll(".chronicle-event").length).toBe(rowsBefore + 1);
        expect(root.querySelector(".dilemma-a")).toBeNull(); // card cleared
        answered = true;
        break;
      }
      const adv = root.querySelector(".btn-advance") as HTMLButtonElement | null;
      if (!adv) break;
      adv.click();
    }
    expect(answered).toBe(true); // conditions + probabilities make one near-certain in 50 turns
  });

  it("logs a per-decade gain/loss line on advance", () => {
    const root = document.createElement("div");
    createPlayApp(root, 1);
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    (root.querySelector(".btn-advance") as HTMLButtonElement).click();
    const rows = [...root.querySelectorAll(".chronicle-event")].map((e) => e.textContent || "");
    expect(rows.some((t) => /Year 10:/.test(t))).toBe(true);
  });

  it("keeps rendering the chronicle across many turns (headline wiring guard)", () => {
    const root = document.createElement("div");
    createPlayApp(root, 1);
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    for (let i = 0; i < 20; i++) {
      const adv = root.querySelector(".btn-advance") as HTMLButtonElement | null;
      if (!adv) break;
      adv.click();
    }
    expect(root.querySelector(".chronicle")).not.toBeNull();
  });

  it("shows the conqueror on the defeat banner, or 'endured' on survival", () => {
    const root = document.createElement("div");
    createPlayApp(root, 1);
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    let banner: Element | null = null;
    for (let i = 0; i < 50; i++) {
      const adv = root.querySelector(".btn-advance") as HTMLButtonElement | null;
      if (!adv) { banner = root.querySelector(".stub"); break; }
      adv.click();
      banner = root.querySelector(".stub");
      if (banner) break;
    }
    expect(banner).not.toBeNull();
    expect(/Conquered by |endured/.test(banner!.textContent || "")).toBe(true);
    expect(banner!.querySelector(".reign-export")).not.toBeNull(); // downloadable reign chronicle
  });

  it("offers an invest action that runs and logs on advance", () => {
    const root = document.createElement("div");
    createPlayApp(root, 1);
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    const investBtns = root.querySelectorAll(".invest-seg button");
    expect(investBtns.length).toBe(2);
    (investBtns[0] as HTMLButtonElement).click(); // nation scope
    (root.querySelector(".btn-advance") as HTMLButtonElement).click();
    expect(root.querySelector(".chronicle")!.textContent).toContain("Invested");
  });

  it("shows a standing panel: momentum headline, two meters, threat line", () => {
    const root = document.createElement("div");
    createPlayApp(root, 1);
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    // before any turn: momentum headline reads "first turn"
    expect(root.querySelector(".momentum")!.textContent).toMatch(/first turn/i);
    // two meters present
    expect(root.querySelector(".meter-strength")).not.toBeNull();
    expect(root.querySelector(".meter-cohesion")).not.toBeNull();
    // threat line present
    expect(root.querySelector(".threat-line")).not.toBeNull();
  });

  it("standing labels have explanatory tooltips + a hover hint, and no false danger tag when healthy", () => {
    const root = document.createElement("div");
    createPlayApp(root, 1);
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    const coh = root.querySelector(".meter-cohesion") as HTMLElement;
    const str = root.querySelector(".meter-strength") as HTMLElement;
    const threat = root.querySelector(".threat-line") as HTMLElement;
    // each standing row carries a non-empty explanatory tooltip
    expect(coh.title.length).toBeGreaterThan(0);
    expect(str.title.length).toBeGreaterThan(0);
    expect(threat.title.length).toBeGreaterThan(0);
    // the cohesion label invites hovering
    expect(coh.querySelector(".meter-label")!.classList.contains("hint")).toBe(true);
    // a fresh realm (cohesion ~50%, not danger) must NOT show the "weakened" consequence tag
    expect(coh.querySelector(".meter-value")!.textContent).not.toMatch(/약해짐|weakened/);
  });

  it("offers restart options when the reign ends, and Play again returns to the picker", () => {
    const root = document.createElement("div");
    createPlayApp(root, 1);
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    // every reign ends by turn 50 (500 years); advance until the game-over banner appears
    for (let i = 0; i < 60; i++) {
      const adv = root.querySelector(".btn-advance") as HTMLButtonElement | null;
      if (!adv) break; // end() clears the command bar
      adv.click();
    }
    expect(root.querySelector(".stub")).not.toBeNull();          // banner shown
    expect(root.querySelector(".btn-play-again")).not.toBeNull();
    expect(root.querySelector(".btn-new-world")).not.toBeNull();
    (root.querySelector(".btn-play-again") as HTMLButtonElement).click();
    expect(root.querySelector(".nation-choice")).not.toBeNull(); // back to the picker
  });

  it("after a turn the momentum headline reports the change (not 'first turn')", () => {
    const root = document.createElement("div");
    createPlayApp(root, 1);
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    (root.querySelector(".btn-advance") as HTMLButtonElement).click();
    const mo = root.querySelector(".momentum")!.textContent || "";
    expect(mo).not.toMatch(/first turn/i);
    expect(mo).toMatch(/This turn/);
  });

  it("lays the play screen out as the HUD shell (old play-col/play-grid layouts gone)", () => {
    const root = document.createElement("div");
    createPlayApp(root, 1);
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    expect(root.querySelector(".play-shell")).not.toBeNull();
    expect(root.querySelector(".play-col")).toBeNull();    // 07c single-column layout retired
    expect(root.querySelector(".play-grid")).toBeNull();   // pre-07c 2-col layout long gone
    // map, standing strip, and command bar all live inside the shell
    const col = root.querySelector(".play-shell")!;
    expect(col.querySelector("svg.world")).not.toBeNull();
    expect(col.querySelector(".play-panel")).not.toBeNull();
    expect(col.querySelector(".play-actions")).not.toBeNull();
  });

  it("shows which nation is the player's: chip with coloured swatch + capital crown, no in-map legend", () => {
    const root = document.createElement("div");
    createPlayApp(root, 1);
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    const chip = root.querySelector(".nation-chip");
    expect(chip).not.toBeNull();
    expect(chip!.textContent).toMatch(/\S/);                       // has the nation name
    expect(root.querySelector(".nation-chip .nation-swatch")).not.toBeNull();
    expect(root.querySelector(".capital-crown")).not.toBeNull();   // ♛ on the map
    expect(root.querySelector("svg.world .nation-label.player")).not.toBeNull(); // player's realm labelled ♛
    expect(root.querySelector(".own-tint")).toBeNull();            // faint tint removed (reserved colour replaces it)
    expect(root.querySelector("svg.world .nation-legend")).toBeNull(); // in-map legend suppressed
  });

  it("command bar has invest segments + advance, and no dropdown at all", () => {
    const root = document.createElement("div");
    createPlayApp(root, 1);
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    expect(root.querySelector(".invest-seg")).not.toBeNull();
    const investBtns = [...root.querySelectorAll(".invest-seg button")];
    expect(investBtns.length).toBe(2); // 내정 다지기 | 국경 방비
    // the number names its metric (안정도/stability) + keeps the %p unit — not a bare "+N%p"
    expect(investBtns.every((b) => /(안정도|stability) \+\d+%p/.test(b.textContent || ""))).toBe(true);
    expect(root.querySelector(".peace-select")).toBeNull(); // peace moved to the neighbor chips
    expect(root.querySelector(".btn-advance")).not.toBeNull();
    expect(root.querySelector(".btn-pass")).not.toBeNull();
    expect(root.querySelector(".action-status")).toBeNull(); // folded into the advance button
    // the old four stacked dropdowns are gone
    expect(root.querySelector(".attack-select")).toBeNull();
    expect(root.querySelector(".found-select")).toBeNull();
    expect(root.querySelector(".invest-select")).toBeNull();
  });

  it("advancing a year still works from the new command bar", () => {
    const root = document.createElement("div");
    createPlayApp(root, 1);
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    const yearBefore = root.querySelector(".play-year")!.textContent;
    (root.querySelector(".btn-advance") as HTMLButtonElement).click();
    expect(root.querySelector(".play-year")!.textContent).not.toBe(yearBefore);
  });

  it("a reign that runs the full 500 years ends with the endurance victory banner", () => {
    const root = document.createElement("div");
    createPlayApp(root, 1);
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    for (let i = 0; i < 60; i++) {
      const adv = root.querySelector(".btn-advance") as HTMLButtonElement | null;
      if (!adv) break;
      adv.click();
    }
    const h2 = root.querySelector(".stub h2")!.textContent || "";
    expect(h2).toMatch(/endured|500/i);   // endurance head, not a defeat/other head
    expect(root.querySelector(".btn-play-again")).not.toBeNull(); // restart still present
  });

  it("shows a compact goals line with the three victory paths", () => {
    const root = document.createElement("div");
    createPlayApp(root, 1);
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    const goals = root.querySelector(".goals");
    expect(goals).not.toBeNull();
    const txt = goals!.textContent || "";
    expect(txt).toMatch(/⚔/);          // conquest readout
    expect(txt).toMatch(/🏘/);          // prosperity readout
    expect(txt).toMatch(/500/);         // endurance readout (year target)
  });

  it("goals render as three labeled chips with explanatory tooltips", () => {
    const root = document.createElement("div");
    createPlayApp(root, 1);
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    const chips = [...root.querySelectorAll(".goal-chip")] as HTMLElement[];
    expect(chips.length).toBe(3);
    for (const c of chips) expect(c.title.length).toBeGreaterThan(0);
    const txt = (root.querySelector(".goals") as HTMLElement).textContent || "";
    expect(txt).toMatch(/⚔/); expect(txt).toMatch(/🏘/); expect(txt).toMatch(/500/);
  });

  it("selecting an attack previews its own effect on both meters (▲ cells, direction-correct cohesion)", () => {
    const root = document.createElement("div");
    createPlayApp(root, 1);
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    expect(root.querySelector(".fx-badge")).toBeNull(); // no pending action → no badges
    // mirror the click mechanism the existing attack test (~playApp.test.ts:100-106) uses
    const target = root.querySelector(".target-cell.capturable") as SVGPathElement;
    target.dispatchEvent(new MouseEvent("click"));
    const sBadge = root.querySelector(".meter-strength .fx-badge");
    const cBadge = root.querySelector(".meter-cohesion .fx-badge");
    expect(sBadge?.textContent).toContain("▲");
    // At turn 0 every realm's cells sit at SOL_INIT (0.5), below CONQUEST_SOL (0.7), so a fresh
    // conquest is MORE loyal than the young realm's baseline and the average ticks up (▲), not
    // down — the "overexpansion" ▼ case only appears once a realm's own cohesion climbs above
    // CONQUEST_SOL in later turns. This assertion verifies the badge exists with the direction
    // that matches that math, not a hardcoded arrow.
    expect(cBadge?.textContent).toContain("▲");
    expect(root.querySelector(".fx-label")).not.toBeNull(); // "your action" scoping label
  });

  it("invest previews cohesion only; pass clears all badges", () => {
    const root = document.createElement("div");
    createPlayApp(root, 1);
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    (root.querySelector(".invest-seg button") as HTMLButtonElement).click();
    expect(root.querySelector(".meter-cohesion .fx-badge")?.textContent).toContain("▲");
    expect(root.querySelector(".meter-strength .fx-badge")).toBeNull();
    (root.querySelector(".btn-pass") as HTMLButtonElement).click();
    expect(root.querySelector(".fx-badge")).toBeNull();
  });

  it("each dilemma choice shows a non-empty effect preview line", () => {
    const root = document.createElement("div");
    createPlayApp(root, 1);
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    let seen = false;
    for (let i = 0; i < 50 && !seen; i++) {
      if (root.querySelector(".dilemma-a")) {
        const fx = [...root.querySelectorAll(".choice-fx")].map((e) => e.textContent || "");
        expect(fx.length).toBe(2);
        expect(fx[0].length).toBeGreaterThan(2);
        expect(fx[1].length).toBeGreaterThan(2);
        seen = true;
        break;
      }
      const adv = root.querySelector(".btn-advance") as HTMLButtonElement | null;
      if (!adv) break;
      adv.click();
    }
    expect(seen).toBe(true);
  });

  it("the advance button states the pending turn (icon + magnitude), and only then", () => {
    const root = document.createElement("div");
    createPlayApp(root, 1);
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    const adv = () => (root.querySelector(".btn-advance") as HTMLButtonElement).textContent || "";
    expect(adv()).not.toContain("⚔");
    expect(adv()).not.toContain("💰");
    const target = root.querySelector(".target-cell.capturable") as SVGPathElement;
    target.dispatchEvent(new MouseEvent("click"));
    expect(adv()).toContain("⚔");
    expect(adv()).toMatch(/\+\d/); // magnitude, e.g. +3
    (root.querySelector(".btn-pass") as HTMLButtonElement).click();
    expect(adv()).not.toContain("⚔");
  });

  it("an unanswered dilemma puts a subtle alert dot on the advance button (never a dialog)", () => {
    const root = document.createElement("div");
    createPlayApp(root, 1);
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    let checked = false;
    for (let i = 0; i < 50 && !checked; i++) {
      if (root.querySelector(".dilemma-a")) {
        expect(root.querySelector(".btn-advance .advance-alert")).not.toBeNull();
        (root.querySelector(".dilemma-a") as HTMLButtonElement).click();
        expect(root.querySelector(".btn-advance .advance-alert")).toBeNull(); // answered → dot gone
        checked = true;
        break;
      }
      const adv = root.querySelector(".btn-advance") as HTMLButtonElement | null;
      if (!adv) break;
      adv.click();
    }
    expect(checked).toBe(true);
  });

  it("a finished reign is recorded in the world's annals, shown when picking again", () => {
    localStorage.clear();
    const root = document.createElement("div");
    createPlayApp(root, 1);
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    for (let i = 0; i < 60; i++) {
      const adv = root.querySelector(".btn-advance") as HTMLButtonElement | null;
      if (!adv) break;
      adv.click();
    }
    expect(root.querySelector(".btn-play-again")).not.toBeNull(); // reached the banner
    (root.querySelector(".btn-play-again") as HTMLButtonElement).click();
    const panel = root.querySelector(".legacy-panel");
    expect(panel).not.toBeNull();
    const rows = root.querySelectorAll(".legacy-row");
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain("1"); // 제1대 / Reign 1
    expect((rows[0].textContent || "").length).toBeGreaterThan(15); // epitaph present
  });

  it("the conqueror's nation card wears the revenge badge after a defeat", () => {
    localStorage.clear();
    const probe = document.createElement("div");
    createPlayApp(probe, 1);
    const names = [...probe.querySelectorAll(".nation-choice .choice-title")].map((e) => e.textContent || "");
    expect(names.length).toBeGreaterThan(1);
    localStorage.setItem("wm:legacy:1", JSON.stringify([{
      v: 1, n: 3, nation: names[1], kind: "defeat", cause: names[0], year: 240,
      peakCells: 120, citiesFounded: 0, epitaph: { code: "epiFallen", data: { name: names[0] } },
    }]));
    const root = document.createElement("div");
    createPlayApp(root, 1);
    const cards = [...root.querySelectorAll(".nation-choice")];
    const conqueror = cards.find((c) => c.querySelector(".choice-title")?.textContent === names[0])!;
    expect(conqueror.querySelector(".revenge-badge")).not.toBeNull();
    const other = cards.find((c) => c.querySelector(".choice-title")?.textContent === names[1])!;
    expect(other.querySelector(".revenge-badge")).toBeNull();
  });

  it("corrupt legacy storage never breaks the picker", () => {
    localStorage.clear();
    localStorage.setItem("wm:legacy:1", "{broken");
    const root = document.createElement("div");
    createPlayApp(root, 1);
    expect(root.querySelectorAll(".nation-choice").length).toBeGreaterThan(0);
    expect(root.querySelector(".legacy-panel")).toBeNull();
  });

  it("bordering rivals wear attitude chips whose tooltips itemize real factors", () => {
    localStorage.clear();
    const root = document.createElement("div");
    createPlayApp(root, 1);
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    const chips = [...root.querySelectorAll(".neighbor-chip")];
    expect(chips.length).toBeGreaterThan(0);
    expect(chips.length).toBeLessThanOrEqual(6);
    const tip = (chips[0] as HTMLElement).title;
    expect(tip).toMatch(/x\d/);          // strength ratio line
    expect(tip.split("\n").length).toBeGreaterThanOrEqual(3); // itemized factors
  });

  it("clicking a chip selects peace (named on the advance button); advancing flips it to friendly", () => {
    localStorage.clear();
    const root = document.createElement("div");
    createPlayApp(root, 1);
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    const chip = root.querySelector(".neighbor-chip") as HTMLElement;
    const name = (chip.textContent || "").replace(/^[⚔👁🤝]\s*/u, "");
    chip.click();
    const adv = () => (root.querySelector(".btn-advance") as HTMLButtonElement).textContent || "";
    expect(adv()).toContain("🕊");
    expect(adv()).toContain(name); // the button confirms WHO, since the dropdown is gone
    expect(root.querySelector(".neighbor-chip.selected")).not.toBeNull();
    expect(root.querySelector(".preview-peace")).not.toBeNull();
    (root.querySelector(".btn-advance") as HTMLButtonElement).click();
    const after = [...root.querySelectorAll(".neighbor-chip")].find((c) => (c.textContent || "").includes(name));
    if (after) {
      expect(after.className).toContain("friendly");
      (after as HTMLElement).click(); // truced chips stay clickable — renewal is allowed
      expect(adv()).toContain("🕊");
    }
  });

  it("clicking the selected chip again cancels the peace pick", () => {
    localStorage.clear();
    const root = document.createElement("div");
    createPlayApp(root, 1);
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    (root.querySelector(".neighbor-chip") as HTMLElement).click();
    expect(root.querySelector(".neighbor-chip.selected")).not.toBeNull();
    (root.querySelector(".neighbor-chip.selected") as HTMLElement).click();
    expect(root.querySelector(".neighbor-chip.selected")).toBeNull();
    expect((root.querySelector(".btn-advance") as HTMLButtonElement).textContent).not.toContain("🕊");
  });

  it("attacking a neighbor leaves a grudge line in its tooltip next turn", () => {
    localStorage.clear();
    const root = document.createElement("div");
    createPlayApp(root, 1);
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    const target = root.querySelector(".target-cell.capturable") as SVGPathElement;
    const targetName = (target.querySelector("title")?.textContent || "").replace(/^⛵ /, "").replace(/ [✓✗].*$/, "");
    target.dispatchEvent(new MouseEvent("click"));
    (root.querySelector(".btn-advance") as HTMLButtonElement).click();
    const chip = [...root.querySelectorAll(".neighbor-chip")].find((c) => (c.textContent || "").includes(targetName)) as HTMLElement | undefined;
    if (chip) expect(chip.title).toMatch(/attacked them|내가 침공/); // still bordering ⇒ the grudge line shows
  });

  it("the momentum line splits the turn into border gains/losses and names the action share", () => {
    localStorage.clear();
    const root = document.createElement("div");
    createPlayApp(root, 1);
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    const target = root.querySelector(".target-cell.capturable") as SVGPathElement;
    target.dispatchEvent(new MouseEvent("click"));
    (root.querySelector(".btn-advance") as HTMLButtonElement).click();
    const mo = root.querySelector(".momentum")!.textContent || "";
    expect(mo).toMatch(/\+\d+ \/ −\d+/);      // border split
    expect(mo).toMatch(/행동|action/);        // the attack's share is attributed
    const br = root.querySelector(".border-report");
    expect(br).not.toBeNull();
    expect((br!.textContent || "").match(/%/g)!.length).toBeGreaterThanOrEqual(2); // both sides
  });

  it("stance tooltips carry the real multipliers, derived from the const tables", () => {
    localStorage.clear();
    const root = document.createElement("div");
    createPlayApp(root, 1);
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    const stanceBtns = [...root.querySelectorAll(".view-toggle button")].filter((b) => !b.className.includes("invest"));
    const withNums = stanceBtns.filter((b) => /×[\d.]+/.test(b.getAttribute("title") || ""));
    expect(withNums.length).toBeGreaterThanOrEqual(3);
  });

  it("mounts the HUD shell: info rail left of the map, commands under it", () => {
    localStorage.clear();
    const root = document.createElement("div");
    createPlayApp(root, 1);
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    const side = root.querySelector(".play-shell > .play-side");
    const main = root.querySelector(".play-shell > .play-main");
    expect(side).not.toBeNull();
    expect(main).not.toBeNull();
    expect(side!.querySelector(".play-panel")).not.toBeNull();
    expect(side!.querySelector(".goals")).not.toBeNull();
    expect(side!.querySelector(".dilemma")).not.toBeNull();
    expect(side!.querySelector(".chronicle")).not.toBeNull();
    expect(main!.querySelector(".stage svg.world")).not.toBeNull();
    expect(main!.querySelector(".play-actions")).not.toBeNull();
  });

  it("the game-over banner lands in the side rail before the chronicle", () => {
    localStorage.clear();
    const root = document.createElement("div");
    createPlayApp(root, 1);
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    for (let i = 0; i < 60; i++) {
      const adv = root.querySelector(".btn-advance") as HTMLButtonElement | null;
      if (!adv) break;
      adv.click();
    }
    const side = root.querySelector(".play-side")!;
    const banner = side.querySelector(".stub");
    expect(banner).not.toBeNull();
    const kids = [...side.children];
    expect(kids.indexOf(banner as Element)).toBeLessThan(kids.indexOf(side.querySelector(".chronicle")!));
  });

  it("island worlds draw dashed expedition lanes and the legend explains them", () => {
    localStorage.clear();
    const root = document.createElement("div");
    createPlayApp(root, 2); // seed 2: capitals span disconnected components
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    expect(root.querySelector(".sea-lane")).not.toBeNull();
    const legend = root.querySelector(".play-legend")!.textContent || "";
    expect(legend).toMatch(/원정|expedition/i);
  });

  function runToGameOver(root: HTMLElement): void {
    createPlayApp(root, 1);
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    for (let i = 0; i < 60; i++) {
      const adv = root.querySelector(".btn-advance") as HTMLButtonElement | null;
      if (!adv) break; // end() replaced the command bar
      adv.click();
    }
  }

  it("game over mounts a replay bar; frame 0 differs from the present, the last frame IS the present", () => {
    const root = document.createElement("div");
    runToGameOver(root);
    const bar = root.querySelector(".play-actions .replay-bar");
    expect(bar).not.toBeNull();
    const slot = () => (root.querySelector(".political-slot") as SVGGElement).innerHTML;
    const live = slot();
    const slider = bar!.querySelector("input.timeline-slider") as HTMLInputElement;
    const max = Number(slider.max);
    expect(max).toBeGreaterThan(0); // one snapshot per tick, so a real reign has many frames
    expect(slider.value).toBe(String(max)); // the bar opens at the present, not year 0
    slider.value = "0";
    slider.dispatchEvent(new Event("input"));
    expect(slot()).not.toBe(live); // territory moved over the reign
    slider.value = String(max);
    slider.dispatchEvent(new Event("input"));
    expect(slot()).toBe(live); // scrubbing to the end lands on the present
  });

  it("the game-over map is a clean atlas: live overlays are gone", () => {
    const root = document.createElement("div");
    runToGameOver(root);
    expect(root.querySelector(".attack-targets")).toBeNull();
    expect(root.querySelector(".front")).toBeNull();
  });

  it("a post-win panel click (stance button) doesn't delete the replay bar", () => {
    // seed 1 / first nation runs a full 60-turn (500-year) reign and survives — an endurance WIN,
    // so renderPanel() takes its full alive-player path: stance buttons, neighbor chips, and the
    // advice button all still render (renderPanel has no `over` guard at all). Their handlers
    // route through renderAll()/renderPending(), whose first call is renderActions() — verified
    // empirically (src/ui/playApp.ts renderPanel/renderActions) that all three controls survive
    // game over on this exact deterministic run.
    vi.useFakeTimers();
    try {
      const root = document.createElement("div");
      runToGameOver(root);
      expect(root.querySelector(".play-actions .replay-bar")).not.toBeNull();
      const stanceBtns = [...root.querySelectorAll(".play-panel .view-toggle button")];
      expect(stanceBtns.length).toBeGreaterThan(0); // confirms the alive/WIN panel path was taken
      // start the replayer (▶) so a stray renderActions() would also orphan its running interval
      (root.querySelector(".replay-bar .timeline-play") as HTMLButtonElement).click();
      const runningTimers = vi.getTimerCount();
      expect(runningTimers).toBeGreaterThan(0);
      (stanceBtns[0] as HTMLButtonElement).click(); // routes through setStance() -> renderAll()
      // the click must NOT wipe .play-actions out from under the replay bar
      expect(root.querySelector(".play-actions .replay-bar")).not.toBeNull();
      // and it must not orphan the old bar's ▶ interval — renderReplayBar() destroys + rebuilds
      expect(vi.getTimerCount()).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("play-again mid-replay stops the replay timer", () => {
    vi.useFakeTimers();
    try {
      const root = document.createElement("div");
      runToGameOver(root);
      // baseline, not necessarily 0: jsdom's localStorage.setItem (recordReign, in end())
      // schedules its own internal setTimeout for cross-tab storage events — unrelated to replay
      const baseline = vi.getTimerCount();
      (root.querySelector(".replay-bar .timeline-play") as HTMLButtonElement).click(); // ▶
      expect(vi.getTimerCount()).toBeGreaterThan(baseline);
      (root.querySelector(".btn-play-again") as HTMLButtonElement).click();
      expect(vi.getTimerCount()).toBe(baseline); // destroy() ran; nothing paints the dead DOM
      expect(root.querySelector(".nation-choice")).not.toBeNull(); // picker is back
    } finally {
      vi.useRealTimers();
    }
  });

  it("the picker shows the daily badge exactly when the seed is today's daily", () => {
    const root = document.createElement("div");
    createPlayApp(root, hashStringToSeed(dailyName(new Date())));
    expect(root.querySelector(".app-title .daily-badge")).not.toBeNull();
    expect((root.querySelector(".daily-badge") as HTMLElement).title.length).toBeGreaterThan(0);
    const other = document.createElement("div");
    createPlayApp(other, 1);
    expect(other.querySelector(".daily-badge")).toBeNull();
  });

  it("the language toggle persists the choice for the next visit", () => {
    const saved = localStorage.getItem("wm:lang");
    try {
      const root = document.createElement("div");
      createPlayApp(root, 1);
      (root.querySelector(".lang-toggle") as HTMLButtonElement).click(); // en → ko
      expect(localStorage.getItem("wm:lang")).toBe("ko");
    } finally {
      if (saved === null) localStorage.removeItem("wm:lang"); // a leaked "ko" would flip later EN assertions
      else localStorage.setItem("wm:lang", saved);
    }
  });

  it("picker puts the map above the nation cards (map-centered layout)", () => {
    const root = document.createElement("div");
    createPlayApp(root, 1);
    const rowEl = root.querySelector(".picker-row")!;
    const map = rowEl.querySelector(".picker-map")!;
    const cards = rowEl.querySelector(".landing")!;
    expect(map).not.toBeNull();
    expect(cards).not.toBeNull();
    // map precedes the card row in DOM order (hero on top, choices below)
    expect(map.compareDocumentPosition(cards) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("clicking a nation's region on the picker map starts that reign", () => {
    // NB: synthetic dispatch skips hit-testing, so this can't catch a CSS pointer-events:none
    // blocking real clicks (jsdom loads no theme.css and does no layout). The picker territory
    // needs `pointer-events: auto` to override the game map's `.political .territory { none }`;
    // that regression is only observable in a real browser (elementFromPoint → path.territory).
    const root = document.createElement("div");
    createPlayApp(root, 1);
    const region = root.querySelector(".picker-map [data-polity]") as SVGElement;
    expect(region).not.toBeNull();
    region.dispatchEvent(new Event("click", { bubbles: true }));
    expect(root.querySelector("svg.world")).not.toBeNull();   // play screen mounted
    expect(root.querySelector(".nation-choice")).toBeNull();  // picker gone
  });

  it("hovering a region on the picker map highlights that nation, like a card", () => {
    const root = document.createElement("div");
    createPlayApp(root, 1);
    const mapBox = root.querySelector(".picker-map")!;
    const magenta = () => mapBox.querySelectorAll(`[fill="${PLAYER_COLOR}"]`).length;
    const region = mapBox.querySelector("[data-polity]") as SVGElement;
    const before = magenta();
    region.dispatchEvent(new Event("mouseover", { bubbles: true }));
    expect(magenta()).toBeGreaterThan(before);
    mapBox.dispatchEvent(new Event("mouseleave"));
    expect(magenta()).toBe(before);
  });

  it("hovering the same region twice does not re-churn the map DOM (keeps the click target stable)", () => {
    // regression: repainting the fills on EVERY mouseover replaces the path under the cursor; the
    // browser then re-fires mouseover on the fresh element → endless churn that detaches the click
    // target mid-gesture, so real clicks never resolve. paintMini must only run when the id changes.
    const root = document.createElement("div");
    createPlayApp(root, 1);
    const map = root.querySelector(".picker-map")!;
    const pid = map.querySelector("[data-polity]")!.getAttribute("data-polity")!;
    map.querySelector("[data-polity]")!.dispatchEvent(new Event("mouseover", { bubbles: true }));
    const afterFirst = map.querySelector(`[data-polity="${pid}"]`);
    afterFirst!.dispatchEvent(new Event("mouseover", { bubbles: true })); // same nation again
    expect(map.querySelector(`[data-polity="${pid}"]`)).toBe(afterFirst); // no rebuild ⇒ stable target
  });

  it("nation card sub uses the friendly 칸/tiles unit, not 셀/cells", () => {
    const root = document.createElement("div");
    createPlayApp(root, 1);
    const sub = root.querySelector(".nation-choice .choice-sub")!.textContent || "";
    expect(sub).toMatch(/칸|tiles/);
    expect(sub).not.toMatch(/셀|cells/);
  });

  it("the nation picker shows a minimap; hovering a card highlights that nation", () => {
    const root = document.createElement("div");
    createPlayApp(root, 1);
    const mapBox = root.querySelector(".picker-map");
    expect(mapBox).not.toBeNull();
    const slot = mapBox!.querySelector(".political-slot")!;
    expect(slot.children.length).toBeGreaterThan(0); // fills painted
    const magenta = () => mapBox!.querySelectorAll(`[fill="${PLAYER_COLOR}"]`).length;
    const before = magenta();
    const card = root.querySelector(".nation-choice") as HTMLButtonElement;
    card.dispatchEvent(new Event("mouseenter"));
    expect(magenta()).toBeGreaterThan(before);
    card.dispatchEvent(new Event("mouseleave"));
    expect(magenta()).toBe(before);
  });

  it("the play map zooms via controls; zoom survives a turn; reset restores", () => {
    const root = document.createElement("div");
    createPlayApp(root, 1);
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    const buttons = () => [...root.querySelectorAll(".map-frame .map-zoom-controls button")] as HTMLButtonElement[];
    expect(buttons().length).toBe(3); // + / − / ⤡
    const svgVb = () => (root.querySelector(".map-frame svg") as SVGSVGElement).getAttribute("viewBox");
    const base = svgVb();
    buttons()[0].click(); // +
    const zoomed = svgVb();
    expect(zoomed).not.toBe(base);
    (root.querySelector(".btn-advance") as HTMLButtonElement).click(); // full map rebuild
    expect(svgVb()).toBe(zoomed); // restore carried the zoom across the re-render
    buttons()[2].click(); // ⤡ (fresh controls on the rebuilt map)
    expect(svgVb()).toBe(base);
  });

  it("the picker shows the ascension badge after a win on this seed, and the annals mark the level", () => {
    const SEED = 424242; // unlikely to collide with other tests' legacy keys
    localStorage.removeItem(`wm:legacy:${SEED}`);
    try {
      const fresh = document.createElement("div");
      createPlayApp(fresh, SEED);
      expect(fresh.querySelector(".asc-badge")).toBeNull(); // A0: no badge

      recordReign(SEED, { nation: "X", kind: "endurance", cause: "", year: 500, peakCells: 10, citiesFounded: 0, epitaph: { code: "epiEndured", data: {} } }); // A0 run: production omits asc entirely
      recordReign(SEED, { nation: "X", kind: "conquest", cause: "", year: 300, peakCells: 90, citiesFounded: 2, epitaph: { code: "epiUnified", data: {} }, asc: 1 });
      const root = document.createElement("div");
      createPlayApp(root, SEED);
      const badge = root.querySelector(".asc-badge") as HTMLElement;
      expect(badge).not.toBeNull();
      expect(badge.textContent).toContain("2");         // two wins ⇒ A2 next
      expect(badge.title.length).toBeGreaterThan(0);
      const rows = [...root.querySelectorAll(".legacy-row")].map((r) => r.textContent || "");
      expect(rows.some((t) => t.includes("⬆1"))).toBe(true); // the A1 win is marked
    } finally {
      localStorage.removeItem(`wm:legacy:${SEED}`);
    }
  });

  describe("chronicle → map ping", () => {
    // advance (passively) until a positioned event lands in the log, or the reign ends
    function playUntilPingable(root: HTMLElement): HTMLElement | null {
      for (let i = 0; i < 50; i++) {
        const pingable = root.querySelector<HTMLElement>(".chronicle-event.pingable");
        if (pingable) return pingable;
        const advance = root.querySelector<HTMLButtonElement>(".btn-advance");
        if (!advance) break; // reign ended
        advance.click();
      }
      return root.querySelector<HTMLElement>(".chronicle-event.pingable");
    }

    it("a positioned chronicle event is pingable; clicking it flashes a map ping at that cell", () => {
      const root = document.createElement("div");
      createPlayApp(root, 1);
      (root.querySelector(".nation-choice") as HTMLButtonElement).click();
      const pingable = playUntilPingable(root);
      expect(pingable).not.toBeNull();
      const cell = Number(pingable!.dataset.cell);
      expect(Number.isInteger(cell)).toBe(true);
      expect(root.querySelector("svg.world .map-ping")).toBeNull(); // nothing pinged yet
      pingable!.click();
      const ping = root.querySelector("svg.world .map-ping");
      expect(ping).not.toBeNull();
    });

    it("the positionless year-delta row is not pingable and never pings", () => {
      const root = document.createElement("div");
      createPlayApp(root, 1);
      (root.querySelector(".nation-choice") as HTMLButtonElement).click();
      (root.querySelector(".btn-advance") as HTMLButtonElement).click();
      // the delta row (e.g. "1010년 · +N / −M") carries no cell — always present after an advance
      const plain = [...root.querySelectorAll<HTMLElement>(".chronicle-event")].find((r) => !r.classList.contains("pingable"));
      expect(plain).not.toBeUndefined();
      expect(plain!.dataset.cell).toBeUndefined();
      plain!.click();
      expect(root.querySelector("svg.world .map-ping")).toBeNull();
    });
  });
});
