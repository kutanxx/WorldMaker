// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mountArmyApp } from "./armyApp";

describe("armyApp (prototype loop: levy -> march -> end turn)", () => {
  let root: HTMLElement;
  beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); });
  afterEach(() => { root.remove(); });

  it("renders a map, a HUD and an end-turn button", () => {
    mountArmyApp(root, { seed: 1 });
    expect(root.querySelector(".army-map")).toBeTruthy();
    expect(root.querySelector(".army-hud")!.textContent).toContain("턴");
    expect(root.querySelector("button.army-end")).toBeTruthy();
    expect(root.querySelectorAll(".army-prov").length).toBeGreaterThan(0);
  });

  it("levies from an owned province: men appear and population drops", () => {
    mountArmyApp(root, { seed: 1 });
    const hudBefore = root.querySelector(".army-hud")!.textContent!;
    const own = root.querySelector(".army-prov[data-mine='1']") as SVGElement;
    own.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const btn = root.querySelector("button.army-levy") as HTMLButtonElement;
    expect(btn).toBeTruthy();
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(root.querySelector(".army-hud")!.textContent).not.toBe(hudBefore); // men went up
    expect(root.querySelector(".army-log")!.textContent).toContain("징집");
  });

  it("ends the turn and advances the counter", () => {
    mountArmyApp(root, { seed: 1 });
    expect(root.querySelector(".army-hud")!.textContent).toContain("턴 0");
    (root.querySelector("button.army-end") as HTMLButtonElement)
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(root.querySelector(".army-hud")!.textContent).toContain("턴 1");
  });
});
