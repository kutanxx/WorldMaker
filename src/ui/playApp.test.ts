// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { createPlayApp } from "./playApp";

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
    expect(root.querySelector(".action-status")).not.toBeNull();   // action status line
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
    const root = document.createElement("div");
    createPlayApp(root, 1);
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    const toggle = root.querySelector(".lang-toggle") as HTMLButtonElement;
    expect(toggle).not.toBeNull();
    toggle.click();
    const panel = root.querySelector(".play-panel")!.textContent!;
    expect(panel).toContain("년");        // Korean year
    expect(panel).toContain("결속");      // Korean "cohesion"
    expect((root.querySelector(".btn-advance") as HTMLButtonElement).textContent).toContain("다음 해");
  });

  it("offers a peace select; picking found-city on the map then invest shares one pending action", () => {
    const root = document.createElement("div");
    createPlayApp(root, 1);
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    const peace = root.querySelector(".peace-select") as HTMLSelectElement;
    expect(peace).not.toBeNull();
    expect(peace.options.length).toBeGreaterThan(1);
    // picking a found-city site on the map, then invest, replaces the pending pick (one action per turn)
    const site = root.querySelector(".site-cell") as SVGPathElement;
    site.dispatchEvent(new Event("click", { bubbles: true }));
    expect(root.querySelector(".action-status")!.textContent).toContain("Found");
    const investBtn = root.querySelector(".invest-seg button") as HTMLButtonElement;
    investBtn.click();
    expect(root.querySelector(".action-status")!.textContent).toContain("Invest");
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
    const peace = root.querySelector(".peace-select") as HTMLSelectElement;
    peace.value = peace.options[1].value;
    peace.dispatchEvent(new Event("change"));
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
    expect((root.querySelector(".action-status") as HTMLElement).textContent).toContain("Attack");
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
    expect((root.querySelector(".action-status") as HTMLElement).textContent).toContain("Found");
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
    (root.querySelector(".howto-start") as HTMLButtonElement).click();
    expect(root.querySelector(".howto")).toBeNull();
    (root.querySelector(".help-btn") as HTMLButtonElement).click(); // reopen
    expect(root.querySelector(".howto")).not.toBeNull();
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
    expect(((root.querySelector(".peace-select") as HTMLSelectElement).title || "").length).toBeGreaterThan(8);
  });

  it("picking invest or peace paints the affected area on the map (action preview)", () => {
    const root = document.createElement("div");
    createPlayApp(root, 1);
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    const investBtns = root.querySelectorAll(".invest-seg button");
    (investBtns[1] as HTMLButtonElement).click(); // border scope (2nd segment)
    expect(root.querySelector(".preview-invest")).not.toBeNull();
    const peace = root.querySelector(".peace-select") as HTMLSelectElement;
    peace.value = peace.options[1].value;
    peace.dispatchEvent(new Event("change"));
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

  it("lays the play screen out as a single centred column (map gets full width)", () => {
    const root = document.createElement("div");
    createPlayApp(root, 1);
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    expect(root.querySelector(".play-col")).not.toBeNull();
    expect(root.querySelector(".play-side")).toBeNull();   // old 2-col sidebar gone
    expect(root.querySelector(".play-grid")).toBeNull();
    // map, standing strip, and command bar all live inside the column
    const col = root.querySelector(".play-col")!;
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
    expect(root.querySelector(".own-tint")).not.toBeNull();        // own-territory wash
    expect(root.querySelector("svg.world .nation-legend")).toBeNull(); // in-map legend suppressed
  });

  it("command bar has invest segments + labelled peace + advance, and no dropdown clutter", () => {
    const root = document.createElement("div");
    createPlayApp(root, 1);
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    expect(root.querySelector(".invest-seg")).not.toBeNull();
    expect(root.querySelectorAll(".invest-seg button").length).toBe(2); // 전국 | 국경
    expect(root.querySelector(".peace-select")).not.toBeNull();
    expect(root.querySelector(".btn-advance")).not.toBeNull();
    expect(root.querySelector(".btn-pass")).not.toBeNull();
    expect(root.querySelector(".action-status")).not.toBeNull();
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
});
