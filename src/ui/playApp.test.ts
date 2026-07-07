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
    expect(root.querySelector(".btn-attack")).not.toBeNull();   // attack action
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

  it("offers found-city and peace selects, one action shared across all four", () => {
    const root = document.createElement("div");
    createPlayApp(root, 1);
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    const found = root.querySelector(".found-select") as HTMLSelectElement;
    const peace = root.querySelector(".peace-select") as HTMLSelectElement;
    const attack = root.querySelector(".attack-select") as HTMLSelectElement;
    expect(found).not.toBeNull();
    expect(peace).not.toBeNull();
    expect(found.options.length).toBeGreaterThan(1);
    expect(peace.options.length).toBeGreaterThan(1);
    // picking attack then foundCity clears the attack pick
    attack.value = attack.options[1].value;
    attack.dispatchEvent(new Event("change"));
    found.value = found.options[1].value;
    found.dispatchEvent(new Event("change"));
    expect(attack.value).toBe("");
    expect((root.querySelector(".btn-attack") as HTMLButtonElement).textContent).toContain("Found");
  });

  it("founding a city logs it and draws a ★ marker on the map", () => {
    const root = document.createElement("div");
    createPlayApp(root, 1);
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    const found = root.querySelector(".found-select") as HTMLSelectElement;
    found.value = found.options[1].value;
    found.dispatchEvent(new Event("change"));
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

  it("map shows clickable attack-target cells; clicking one picks the attack and syncs the select", () => {
    const root = document.createElement("div");
    createPlayApp(root, 1);
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    const targets = root.querySelectorAll(".target-cell");
    expect(targets.length).toBeGreaterThan(0);
    const cell = (targets[0] as SVGPathElement).getAttribute("data-cell")!;
    (targets[0] as SVGPathElement).dispatchEvent(new Event("click", { bubbles: true }));
    expect((root.querySelector(".attack-select") as HTMLSelectElement).value).toBe(cell);
    expect((root.querySelector(".btn-attack") as HTMLButtonElement).textContent).toContain("Attack");
    // the picked cell is marked selected on the map
    expect(root.querySelector(".target-cell.selected")).not.toBeNull();
  });

  it("capturable targets are drawn as the whole region the attack would take (data-gain), and the select advertises it", () => {
    const root = document.createElement("div");
    createPlayApp(root, 1);
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    const caps = [...root.querySelectorAll(".target-cell.capturable")];
    expect(caps.length).toBeGreaterThan(0);
    for (const c of caps) expect(Number(c.getAttribute("data-gain"))).toBeGreaterThanOrEqual(1);
    // a breakthrough region is one path made of several cell subpaths (multiple "M" commands)
    const multi = caps.find((c) => Number(c.getAttribute("data-gain")) > 1);
    if (multi) expect((multi.getAttribute("d")!.match(/M/g) || []).length).toBe(Number(multi.getAttribute("data-gain")));
    const opts = [...root.querySelectorAll(".attack-select option")].map((o) => o.textContent || "");
    expect(opts.some((t) => /×\d/.test(t))).toBe(true);
  });

  it("shows clickable found-city sites on the map; clicking one picks foundCity and syncs the select", () => {
    const root = document.createElement("div");
    createPlayApp(root, 1);
    (root.querySelector(".nation-choice") as HTMLButtonElement).click();
    const sites = root.querySelectorAll(".site-cell");
    expect(sites.length).toBeGreaterThan(0);
    expect(sites.length).toBeLessThanOrEqual(20);
    const cell = (sites[0] as SVGPathElement).getAttribute("data-cell")!;
    (sites[0] as SVGPathElement).dispatchEvent(new Event("click", { bubbles: true }));
    expect((root.querySelector(".found-select") as HTMLSelectElement).value).toBe(cell);
    expect((root.querySelector(".btn-attack") as HTMLButtonElement).textContent).toContain("Found");
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
    const stanceBtns = [...root.querySelectorAll(".view-toggle button")];
    expect(stanceBtns.length).toBe(3);
    for (const b of stanceBtns) expect((b.getAttribute("title") || "").length).toBeGreaterThan(4);
    expect(root.querySelector(".play-panel")!.textContent).toMatch(/steady|shaky|critical/);
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
    const inv = root.querySelector(".invest-select") as HTMLSelectElement;
    expect(inv).not.toBeNull();
    inv.value = "nation";
    inv.dispatchEvent(new Event("change", { bubbles: true }));
    (root.querySelector(".btn-advance") as HTMLButtonElement).click();
    expect(root.querySelector(".chronicle")!.textContent).toContain("Invested");
  });
});
