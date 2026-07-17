// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { mountProvinceApp, provinceCellOwner } from "./provinceApp";
import { generateWorld } from "../engine/world";
import { DEFAULT_PARAMS } from "../types/world";
import { initProvinceSim } from "../engine/provinceSim";

describe("provinceCellOwner", () => {
  it("maps each cell to its province's owner, ocean/unowned to -1", () => {
    const provinceOf = [0, 0, 1, -1];
    const provOwner = Int32Array.from([5, 2]); // prov 0 → nation 5, prov 1 → nation 2
    expect(Array.from(provinceCellOwner(4, provinceOf, provOwner))).toEqual([5, 5, 2, -1]);
  });
});

describe("mountProvinceApp (seed 1)", () => {
  let root: HTMLElement;
  beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); });

  it("renders the province map: a framed svg with owner-colored polity paths and a nation border", () => {
    mountProvinceApp(root, { seed: 1 });
    const svg = root.querySelector("svg") as SVGSVGElement;
    expect(svg).toBeTruthy();
    expect(svg.getAttribute("viewBox")).toBe("0 0 1000 700"); // grid.width x grid.height (DEFAULT_PARAMS)
    // politicalLayer emits one path per owning polity, tagged data-polity
    expect(root.querySelectorAll("[data-polity]").length).toBeGreaterThan(0);
    // and the snapped nation border overlay is present
    expect(root.querySelector(".nation-border")).toBeTruthy();
  });

  it("does not mutate the world's province objects (read-only aliasing guard)", () => {
    const world = generateWorld({ ...DEFAULT_PARAMS, seed: 1 }).world;
    const before = world.provinces[0].cells;
    const s = initProvinceSim(world);
    provinceCellOwner(world.grid.count, world.provinceOf, s.provOwner);
    expect(world.provinces[0].cells).toBe(before);
  });
});

describe("province picker → play (seed 1)", () => {
  let root: HTMLElement;
  beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); });

  it("clicking a live nation's territory starts a game and shows the HUD", () => {
    mountProvinceApp(root, { seed: 1 });
    const path = root.querySelector("[data-polity]") as SVGPathElement;
    const pid = Number(path.getAttribute("data-polity"));
    path.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const hud = root.querySelector(".prov-hud");
    expect(hud).toBeTruthy();
    expect(hud!.textContent).toMatch(/0\s*\/\s*50/); // turn 0 of 50
    // the started nation is painted with the player colour
    const playerPath = root.querySelector(`[data-polity="${pid}"]`) as SVGPathElement;
    expect(playerPath.getAttribute("fill")).toBe("#c0247a"); // PLAYER_COLOR (src/ui/nationPalette.ts:20)
  });
});

describe("province turn loop (seed 1)", () => {
  let root: HTMLElement;
  beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); });

  function startAsFirstPolity(): number {
    mountProvinceApp(root, { seed: 1 });
    const path = root.querySelector("[data-polity]") as SVGPathElement;
    const pid = Number(path.getAttribute("data-polity"));
    path.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    return pid;
  }

  it("only armable provinces get a target overlay, and clicking toggles the armed class", () => {
    startAsFirstPolity();
    const targets = root.querySelectorAll(".prov-target");
    expect(targets.length).toBeGreaterThan(0);
    const first = targets[0] as SVGPathElement;
    expect(first.classList.contains("armed")).toBe(false);
    first.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    // after a click the same province path (re-rendered) is armed
    const provId = first.getAttribute("data-province");
    const armed = root.querySelector(`.prov-target[data-province="${provId}"]`) as SVGPathElement;
    expect(armed.classList.contains("armed")).toBe(true);
  });

  it("advancing bumps the turn and logs any conquest", () => {
    startAsFirstPolity();
    const target = root.querySelector(".prov-target") as SVGPathElement;
    target.dispatchEvent(new MouseEvent("click", { bubbles: true })); // arm one province
    (root.querySelector(".prov-advance") as HTMLButtonElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(root.querySelector(".prov-hud")!.textContent).toMatch(/1\s*\/\s*50/); // turn advanced
  });
});
