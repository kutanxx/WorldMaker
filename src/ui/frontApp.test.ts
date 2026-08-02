// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mountFrontApp, paintPlan } from "./frontApp";
import { generateWorld } from "../engine/world";
import { DEFAULT_PARAMS } from "../types/world";
import { initFrontSim, setOwner, SEA, UNOWNED } from "../engine/frontSim";

describe("frontApp", () => {
  let root: HTMLElement;
  beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); });
  afterEach(() => { root.remove(); });

  it("paints every land cell and leaves the sea alone", () => {
    const s = initFrontSim(generateWorld({ ...DEFAULT_PARAMS, seed: 11 }).world);
    const player = [...s.owner].find((o) => o >= 0)!;
    const plan = paintPlan(s, player);
    const land = [...Array(s.n).keys()].filter((c) => s.owner[c] !== SEA);
    expect(plan).toHaveLength(land.length);
    expect(plan.every((p) => s.owner[p.cell] !== SEA)).toBe(true);
    expect(plan.map((p) => p.cell)).toEqual(land);          // ascending, so redraws are stable
  });

  it("gives the player its own colour, distinct from unowned land and from rivals", () => {
    const s = initFrontSim(generateWorld({ ...DEFAULT_PARAMS, seed: 11 }).world);
    const nations = [...new Set([...s.owner].filter((o) => o >= 0))].sort((a, b) => a - b);
    const player = nations[0], rival = nations[1];
    const fill = (cell: number) => paintPlan(s, player).find((p) => p.cell === cell)!.fill;
    const mine = [...Array(s.n).keys()].find((c) => s.owner[c] === player)!;
    const theirs = [...Array(s.n).keys()].find((c) => s.owner[c] === rival)!;
    const empty = [...Array(s.n).keys()].find((c) => s.owner[c] === UNOWNED);
    expect(fill(mine)).not.toBe(fill(theirs));
    if (empty !== undefined) expect(fill(mine)).not.toBe(fill(empty));
  });

  it("repaints as ownership changes", () => {
    const s = initFrontSim(generateWorld({ ...DEFAULT_PARAMS, seed: 11 }).world);
    const player = [...s.owner].find((o) => o >= 0)!;
    const cell = [...Array(s.n).keys()].find((c) => s.owner[c] !== SEA && s.owner[c] !== player)!;
    const before = paintPlan(s, player).find((p) => p.cell === cell)!.fill;
    setOwner(s, cell, player);
    expect(paintPlan(s, player).find((p) => p.cell === cell)!.fill).not.toBe(before);
  });

  it("mounts without a 2d context and still renders the HUD and the controls", () => {
    // jsdom has no canvas backend, so getContext returns null. Mounting must survive that, or none
    // of the input tests below could exist at all.
    mountFrontApp(root, { seed: 11 });
    expect(root.querySelector("canvas.front-map")).toBeTruthy();
    const hud = root.querySelector(".front-hud")!;
    expect(hud.textContent).toMatch(/\d/);
    expect(root.querySelector("input.front-commit")).toBeTruthy();
  });

  it("shows the pool against the cap, and the commit slider in both percent and troops", () => {
    mountFrontApp(root, { seed: 11 });
    const hud = root.querySelector(".front-hud")!.textContent!;
    expect(hud).toMatch(/\d+\s*\/\s*\d+/);                 // pool / cap
    const commit = root.querySelector(".front-commit-label")!.textContent!;
    expect(commit).toMatch(/%/);
    expect(commit).toMatch(/\(\d+\)/);                     // absolute troops in brackets
  });

  it("moving the slider changes the troops it says it will send", () => {
    mountFrontApp(root, { seed: 11 });
    const slider = root.querySelector("input.front-commit") as HTMLInputElement;
    const read = () => root.querySelector(".front-commit-label")!.textContent!;
    slider.value = "20";
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    const low = read();
    slider.value = "80";
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    expect(read()).not.toBe(low);
    expect(read()).toContain("80%");
  });
});
