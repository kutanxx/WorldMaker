// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { createPlayApp } from "./playApp";

describe("playApp", () => {
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
