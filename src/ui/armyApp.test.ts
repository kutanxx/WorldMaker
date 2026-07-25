// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mountArmyApp } from "./armyApp";

describe("armyApp (prototype loop: levy -> march -> end turn)", () => {
  let root: HTMLElement;
  beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); });
  afterEach(() => { root.remove(); });

  // picker mode is the new entry point (Task 4) — pick a nation before running the pre-existing
  // assertions, which all assume a game already in progress.
  function pickNation(): void {
    const label = root.querySelector(".army-pick-label") as HTMLElement;
    const id = label.getAttribute("data-polity")!;
    (root.querySelector(`.army-prov[data-polity="${id}"]`) as SVGElement)
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }

  it("renders a map, a HUD and an end-turn button", () => {
    mountArmyApp(root, { seed: 1 });
    pickNation();
    expect(root.querySelector(".army-map")).toBeTruthy();
    expect(root.querySelector(".army-hud")!.textContent).toContain("턴");
    expect(root.querySelector("button.army-end")).toBeTruthy();
    expect(root.querySelectorAll(".army-prov").length).toBeGreaterThan(0);
  });

  it("levies from an owned province: men appear and population drops", () => {
    mountArmyApp(root, { seed: 1 });
    pickNation();
    const hudBefore = root.querySelector(".army-hud")!.textContent!;
    const own = root.querySelector(".army-prov[data-mine='1']") as SVGElement;
    own.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const btn = root.querySelector("button.army-levy") as HTMLButtonElement;
    expect(btn).toBeTruthy();
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(root.querySelector(".army-hud")!.textContent).not.toBe(hudBefore); // men went up
    expect(root.querySelector(".army-log")!.textContent).toContain("징집");
  });

  it("prints the seed in the HUD so a play-test session can be identified", () => {
    mountArmyApp(root, { seed: 1 });
    pickNation();
    expect(root.querySelector(".army-hud")!.textContent).toContain("시드 1");
  });

  it("ends the turn and advances the counter", () => {
    mountArmyApp(root, { seed: 1 });
    pickNation();
    expect(root.querySelector(".army-hud")!.textContent).toContain("턴 0");
    (root.querySelector("button.army-end") as HTMLButtonElement)
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(root.querySelector(".army-hud")!.textContent).toContain("턴 1");
  });

  it("clicking a province of mine always selects it, and clicking foreign land just clears the selection", () => {
    mountArmyApp(root, { seed: 1 });
    pickNation();
    const mine = root.querySelector(".army-prov[data-mine='1']") as SVGElement;
    expect(mine).toBeTruthy();
    mine.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(root.querySelector(".army-sel")!.textContent).not.toContain("내 영토를 클릭해 선택하세요");
    const logBefore = root.querySelector(".army-log")!.textContent;
    const foreign = root.querySelector(".army-prov[data-mine='0']") as SVGElement;
    expect(foreign).toBeTruthy();
    foreign.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    // a click on land that isn't mine never marches — it only clears the selection
    expect(root.querySelector(".army-sel")!.textContent).toContain("내 영토를 클릭해 선택하세요");
    expect(root.querySelector(".army-log")!.textContent).toBe(logBefore);
  });

  it("marches only via a panel button, and a spent army reads as spent and cannot march again", () => {
    mountArmyApp(root, { seed: 1 });
    pickNation();
    const mineEls = Array.from(root.querySelectorAll(".army-prov[data-mine='1']")) as SVGElement[];
    let moveBtn: HTMLButtonElement | undefined;
    for (const el of mineEls) {
      el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      const levyBtn = root.querySelector("button.army-levy") as HTMLButtonElement;
      if (!levyBtn.disabled) levyBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      moveBtn = Array.from(root.querySelectorAll("button.army-move"))
        .find((b) => (b as HTMLElement).textContent!.includes("행군")) as HTMLButtonElement | undefined;
      if (moveBtn) break;
    }
    expect(moveBtn).toBeTruthy();
    const target = moveBtn!.dataset.target;
    const logBefore = root.querySelector(".army-log")!.textContent;
    moveBtn!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(root.querySelector(".army-log")!.textContent).not.toBe(logBefore);
    expect(root.querySelector(".army-log")!.textContent).toContain("이동");

    // re-select the province the army just arrived in: it must read as spent, and its move
    // buttons must be disabled so a further click cannot launder a second move.
    const arrived = root.querySelector(`.army-prov[data-prov='${target}']`) as SVGElement;
    arrived.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(root.querySelector(".army-sel")!.textContent).toContain("이미 이동함");
    const disabledMoves = root.querySelectorAll("button.army-move");
    expect(disabledMoves.length).toBeGreaterThan(0);
    disabledMoves.forEach((b) => expect((b as HTMLButtonElement).disabled).toBe(true));
  });
});

describe("nation picker", () => {
  let root: HTMLElement;
  beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); });
  afterEach(() => { root.remove(); });

  it("starts in picker mode with a label per nation, and no game HUD yet", () => {
    mountArmyApp(root, { seed: 1 });
    expect(root.querySelector(".army-pick")).toBeTruthy();
    const labels = [...root.querySelectorAll(".army-pick-label")];
    expect(labels.length).toBeGreaterThan(1);
    expect(labels[0].textContent).toMatch(/영토 \d+/);
    expect(labels[0].textContent).toMatch(/인구 \d+/);
    expect(root.querySelector("button.army-end")).toBeNull();
  });

  it("starts the game as the nation you click", () => {
    mountArmyApp(root, { seed: 1 });
    const label = root.querySelector(".army-pick-label") as HTMLElement;
    const id = label.getAttribute("data-polity")!;
    const name = label.textContent!.split(" · ")[0];
    (root.querySelector(`.army-prov[data-polity="${id}"]`) as SVGElement)
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(root.querySelector(".army-pick")).toBeNull();
    expect(root.querySelector(".army-hud")!.textContent).toContain(name);
    expect(root.querySelector("button.army-end")).toBeTruthy();
  });
});

describe("odds are quoted, not promised", () => {
  let root: HTMLElement;
  beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); });
  afterEach(() => { root.remove(); });

  it("shows a percentage on hostile move rows instead of a guaranteed verdict", () => {
    mountArmyApp(root, { seed: 1 });
    (root.querySelector(".army-prov[data-polity]") as SVGElement)
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    // levy everywhere until some province offers a hostile move row
    let row: Element | null = null;
    for (const el of [...root.querySelectorAll('.army-prov[data-mine="1"]')]) {
      el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      for (let i = 0; i < 4; i++) {
        const b = root.querySelector("button.army-levy") as HTMLButtonElement | null;
        if (b && !b.disabled) b.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      }
      el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      row = [...root.querySelectorAll("button.army-move")].find((b) => /공격/.test(b.textContent || "")) ?? null;
      if (row) break;
    }
    expect(row).toBeTruthy();
    expect(row!.textContent).toMatch(/\d+%/);          // odds are shown
    expect(row!.textContent).not.toContain("승리 예상"); // no promise
  });
});
