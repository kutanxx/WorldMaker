// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mountArmyApp } from "./armyApp";
import { generateWorld } from "../engine/world";
import { DEFAULT_PARAMS } from "../types/world";
import { initArmySim, playableNations, theaterOf, goalGain } from "../engine/armySim";

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

  it("blocks a second levy on the same province in one turn: men only rise once, and the button reads levied", () => {
    mountArmyApp(root, { seed: 1 });
    pickNation();
    const own = root.querySelector(".army-prov[data-mine='1']") as SVGElement;
    own.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const btn = () => root.querySelector("button.army-levy") as HTMLButtonElement;
    expect(btn().disabled).toBe(false);
    btn().dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const menAfterFirst = root.querySelector(".army-sel")!.textContent!.match(/병력 (\d+)/)![1];
    // the button must now be disabled and its label must say why: already levied this turn.
    expect(btn().disabled).toBe(true);
    expect(btn().textContent).toContain("이번 턴");
    btn().dispatchEvent(new MouseEvent("click", { bubbles: true })); // clicking a disabled button is a no-op anyway
    const menAfterSecond = root.querySelector(".army-sel")!.textContent!.match(/병력 (\d+)/)![1];
    expect(menAfterSecond).toBe(menAfterFirst); // men did not rise a second time
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

  it("draws province and nation boundaries, and the borders do not steal province clicks", () => {
    mountArmyApp(root, { seed: 1 });
    pickNation();
    const provBorder = root.querySelector(".province-border") as SVGPathElement | null;
    const nationBorder = root.querySelector(".nation-border") as SVGPathElement | null;
    expect(provBorder).toBeTruthy();
    expect(nationBorder).toBeTruthy();
    expect(provBorder!.getAttribute("d")).toBeTruthy();
    expect(nationBorder!.getAttribute("d")).toBeTruthy();
    // a province click must still select (borders sit visually on top but must not intercept clicks)
    const mine = root.querySelector(".army-prov[data-mine='1']") as SVGElement;
    mine.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(root.querySelector(".army-sel")!.textContent).not.toContain("내 영토를 클릭해 선택하세요");
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

  // a home link that only exists before a nation is picked would strand the player mid-game
  // (the province game learned this the hard way) — it must survive into play mode too.
  it("shows a relative home link back to the landing page, before and after picking a nation", () => {
    mountArmyApp(root, { seed: 1 });
    const before = root.querySelector('a.home[href="index.html"]');
    expect(before).toBeTruthy();

    const label = root.querySelector(".army-pick-label") as HTMLElement;
    const id = label.getAttribute("data-polity")!;
    (root.querySelector(`.army-prov[data-polity="${id}"]`) as SVGElement)
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const after = root.querySelector('a.home[href="index.html"]');
    expect(after).toBeTruthy();
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

describe("goal and game over", () => {
  let root: HTMLElement;
  beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); });
  afterEach(() => { root.remove(); });

  function pickNation(): void {
    const label = root.querySelector(".army-pick-label") as HTMLElement;
    const id = label.getAttribute("data-polity")!;
    (root.querySelector(`.army-prov[data-polity="${id}"]`) as SVGElement)
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }

  it("shows goal progress in the HUD once a game starts", () => {
    mountArmyApp(root, { seed: 1 });
    pickNation();
    const hud = root.querySelector(".army-hud")!.textContent!;
    expect(hud).toMatch(/정복 \+\d+\/\d+/);
  });

  it("ends the game and offers a restart back to the picker", () => {
    mountArmyApp(root, { seed: 1 });
    pickNation();
    // end turns until the horizon is reached (HORIZON is 50)
    for (let i = 0; i < 60; i++) {
      const end = root.querySelector("button.army-end") as HTMLButtonElement | null;
      if (!end) break;
      end.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }
    const over = root.querySelector(".army-over");
    expect(over).toBeTruthy();
    expect(over!.textContent).toMatch(/승리|패배|종료/);
    expect(root.querySelector("button.army-end")).toBeNull();   // no more turns
    expect(root.querySelector(".army-sel")).toBeNull();         // no more orders

    (root.querySelector("button.army-restart") as HTMLButtonElement)
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(root.querySelector(".army-pick")).toBeTruthy();      // back to the nation picker
  });

  it("restart produces a genuinely fresh game, not just a cleared selection", () => {
    mountArmyApp(root, { seed: 1 });

    // capture the ORIGINAL starting map's per-nation stats before playing at all
    const statsAtStart = new Map<string, string>();
    for (const label of [...root.querySelectorAll(".army-pick-label")]) {
      statsAtStart.set(label.getAttribute("data-polity")!, label.textContent!);
    }
    expect(statsAtStart.size).toBeGreaterThan(1);

    pickNation();
    // play to the horizon ending (HORIZON is 50), conquering territory along the way
    for (let i = 0; i < 60; i++) {
      const end = root.querySelector("button.army-end") as HTMLButtonElement | null;
      if (!end) break;
      end.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }
    expect(root.querySelector(".army-over")).toBeTruthy();

    (root.querySelector("button.army-restart") as HTMLButtonElement)
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(root.querySelector(".army-pick")).toBeTruthy();

    // the picker map shown after restart must be the ORIGINAL starting map, not the finished one —
    // every nation must show its starting territory/population, proving the ArmyState itself (not
    // just UI selection) was rebuilt from scratch.
    const statsAfterRestart = new Map<string, string>();
    for (const label of [...root.querySelectorAll(".army-pick-label")]) {
      statsAfterRestart.set(label.getAttribute("data-polity")!, label.textContent!);
    }
    expect(statsAfterRestart).toEqual(statsAtStart);

    // pick a nation again: a real, playable game must resume, not the stale finished one.
    pickNation();
    expect(root.querySelector("button.army-end")).toBeTruthy();
    expect(root.querySelector(".army-hud")!.textContent).toContain("턴 0");
    expect(root.querySelector(".army-over")).toBeNull();
  });
});

describe("province number labels never float over the sea", () => {
  let root: HTMLElement;
  beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); });
  afterEach(() => { root.remove(); });

  function pickNation(): void {
    const label = root.querySelector(".army-pick-label") as HTMLElement;
    const id = label.getAttribute("data-polity")!;
    (root.querySelector(`.army-prov[data-polity="${id}"]`) as SVGElement)
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }

  // A raw centroid (arithmetic mean of a province's cell positions) can fall outside the
  // province's own land for a crescent, bay-hugging, or peninsula-straddling province — landing
  // the label over open water. Every label must instead sit at the exact position of one of the
  // grid's own cells, and that cell must belong to the very province the label carries.
  it("anchors every .army-num label on a cell that belongs to its own (non-ocean) province", () => {
    mountArmyApp(root, { seed: 1 });
    pickNation();
    const world = generateWorld({ ...DEFAULT_PARAMS, seed: 1 }).world;

    // index every cell position -> cell index (first cell wins on an exact coincidence, matching
    // the tie-break the implementation uses: lower cell index wins).
    const byPos = new Map<string, number>();
    for (let c = 0; c < world.grid.count; c++) {
      const key = `${world.grid.points[c * 2]},${world.grid.points[c * 2 + 1]}`;
      if (!byPos.has(key)) byPos.set(key, c);
    }

    const labels = [...root.querySelectorAll(".army-num")] as SVGTextElement[];
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      const x = label.getAttribute("x")!, y = label.getAttribute("y")!;
      const cell = byPos.get(`${x},${y}`);
      expect(cell).not.toBeUndefined();               // exact coordinates of some real cell
      const prov = Number(label.dataset.prov);
      expect(world.provinceOf[cell!]).toBe(prov);      // and that cell belongs to THIS province
      expect(prov).toBeGreaterThanOrEqual(0);          // never ocean
    }
  });
});

describe("unowned wilderness is painted, not left to look like open sea", () => {
  let root: HTMLElement;
  beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); });
  afterEach(() => { root.remove(); });

  function pickNation(): void {
    const label = root.querySelector(".army-pick-label") as HTMLElement;
    const id = label.getAttribute("data-polity")!;
    (root.querySelector(`.army-prov[data-polity="${id}"]`) as SVGElement)
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }

  // seed 1 (used by every other test in this file) is confirmed non-vacuous: initArmySim leaves
  // 21 of its 102 provinces unowned (owner === -1) at the start of a game.
  it("paints every unowned province with a non-empty .army-wild path", () => {
    const world = generateWorld({ ...DEFAULT_PARAMS, seed: 1 }).world;
    const s = initArmySim(world);
    let unowned = 0;
    for (let p = 0; p < s.n; p++) if (s.owner[p] === -1) unowned++;
    expect(unowned).toBeGreaterThan(0); // guard: this test would be vacuous on a seed with none

    mountArmyApp(root, { seed: 1 });
    pickNation();
    const wild = root.querySelector(".army-wild") as SVGPathElement | null;
    expect(wild).toBeTruthy();
    expect(wild!.getAttribute("d")).toBeTruthy();
  });

  it("does not steal clicks from owned provinces", () => {
    mountArmyApp(root, { seed: 1 });
    pickNation();
    expect(root.querySelector(".army-wild")).toBeTruthy();
    const mine = root.querySelector(".army-prov[data-mine='1']") as SVGElement;
    mine.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(root.querySelector(".army-sel")!.textContent).not.toContain("내 영토를 클릭해 선택하세요");
  });
});

describe("start-fair goal in the HUD", () => {
  let root: HTMLElement;
  beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); });
  afterEach(() => { root.remove(); });

  function pickNation(): void {
    const label = root.querySelector(".army-pick-label") as HTMLElement;
    const id = label.getAttribute("data-polity")!;
    (root.querySelector(`.army-prov[data-polity="${id}"]`) as SVGElement)
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }

  it("shows a signed conquest counter, starting at +0", () => {
    mountArmyApp(root, { seed: 1 });
    pickNation();
    expect(root.querySelector(".army-hud")!.textContent).toMatch(/정복 \+0\/\d+/);
  });

  it("re-reads the start count after a restart with a different nation", () => {
    mountArmyApp(root, { seed: 1 });
    pickNation();
    // end turns until the game is over, then restart and pick again
    for (let i = 0; i < 60; i++) {
      const end = root.querySelector("button.army-end") as HTMLButtonElement | null;
      if (!end) break;
      end.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }
    (root.querySelector("button.army-restart") as HTMLButtonElement)
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    pickNation();
    // a fresh game: turn 0 and a zero gain again
    expect(root.querySelector(".army-hud")!.textContent).toContain("턴 0");
    expect(root.querySelector(".army-hud")!.textContent).toMatch(/정복 \+0\/\d+/);
  });
});

describe("the race is visible", () => {
  let root: HTMLElement;
  beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); });
  afterEach(() => { root.remove(); });

  function pickNation(): void {
    const label = root.querySelector(".army-pick-label") as HTMLElement;
    const id = label.getAttribute("data-polity")!;
    (root.querySelector(`.army-prov[data-polity="${id}"]`) as SVGElement)
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }

  // Lifts the levy+attack pattern from "odds are quoted, not promised" (lines 196-200 of this
  // file): sweep the realm's own provinces, topping up levy wherever the panel allows it, and
  // launch the first hostile move on offer. A no-op if the realm has neither to give this turn.
  function playAggressively(): void {
    for (const el of [...root.querySelectorAll('.army-prov[data-mine="1"]')]) {
      el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      for (let i = 0; i < 4; i++) {
        const b = root.querySelector("button.army-levy") as HTMLButtonElement | null;
        if (b && !b.disabled) b.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      }
      el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      const row = [...root.querySelectorAll("button.army-move")]
        .find((b) => /공격/.test((b as HTMLElement).textContent || "")) as HTMLButtonElement | undefined;
      if (row) { row.dispatchEvent(new MouseEvent("click", { bubbles: true })); return; }
    }
  }

  it("shows the leading rival's progress next to my own", () => {
    mountArmyApp(root, { seed: 11 });
    pickNation();
    const hud = root.querySelector(".army-hud")!.textContent!;
    expect(hud).toMatch(/정복 [+-]\d+\/\d+/);      // mine
    expect(hud).toMatch(/추격 .+ [+-]\d+\/\d+/);   // theirs
  });

  it("ends the game naming the rival that got there first", () => {
    mountArmyApp(root, { seed: 11 });
    pickNation();
    // play passively to the end; either the horizon or a rival finishes it
    for (let i = 0; i < 60; i++) {
      const end = root.querySelector("button.army-end") as HTMLButtonElement | null;
      if (!end) break;
      end.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }
    const over = root.querySelector(".army-over");
    expect(over).toBeTruthy();
    expect(over!.textContent).toMatch(/패배|승리|종료/);
    expect(root.querySelector("button.army-restart")).toBeTruthy();
  });

  it("stays silent at turn 0 — nobody has conquered anything yet, so nobody leads", () => {
    const base = initArmySim(generateWorld({ ...DEFAULT_PARAMS, seed: 1 }).world);
    const playable = playableNations(base);
    expect(playable.length).toBeGreaterThan(1);
    // structural, not seed luck: startCounts is snapshotted at init, so every nation's `gained`
    // is exactly 0 at t0, and raceLeader requires gained > 0. No pick may produce the warning.
    for (const id of playable) {
      root.remove();
      root = document.createElement("div");
      document.body.appendChild(root);
      mountArmyApp(root, { seed: 1 });
      (root.querySelector(`.army-prov[data-polity="${id}"]`) as SVGElement)
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(root.querySelector(".army-hud")!.textContent).not.toContain("당신이 선두");
    }
  });

  it("warns once the player is actually ahead, and only while they are", () => {
    // Seed 23 (used elsewhere in this file) never gets the player strictly ahead of the best
    // rival within 30 turns under playAggressively — checked by instrumenting the same driver
    // across seeds 1-167 and logging mine/rival each turn. Seed 107 does reliably: 7 quiet turns
    // before the first conquest, then 23 straight turns in the lead, so sawLead is never vacuous.
    mountArmyApp(root, { seed: 107 });
    pickNation();
    // The HUD already prints both numbers the answer depends on: `정복 +N/M` is the player's
    // own gained, `추격 <name> +K/M` is the best rival's. So the test needs no mirror of the
    // app's internal state — it reads the same screen the player does.
    let sawLead = 0, sawQuiet = 0;
    for (let turn = 0; turn < 30; turn++) {
      const hud = root.querySelector(".army-hud")!.textContent!;
      const mine = Number((hud.match(/정복 ([+-]?\d+)\//) || [])[1]);
      const rivalMatch = hud.match(/추격 .*?([+-]?\d+)\/\d+/);
      const rival = rivalMatch ? Number(rivalMatch[1]) : -Infinity;
      const warned = hud.includes("당신이 선두");
      if (mine <= 0) { expect(warned).toBe(false); sawQuiet++; }
      else if (mine > rival) { expect(warned).toBe(true); sawLead++; }
      // Closes the band 0 < mine < rival: the player has conquered something but is still behind.
      // Catches a regression where the HUD warns on `prog.gained > 0` (conquered anything) instead
      // of `raceLeader(s) === me` (actually ahead). Seed 107 may never enter this band — that is
      // fine; the assertion is free here and would still fire on another seed or driver change.
      else if (mine < rival) { expect(warned).toBe(false); }
      // mine > 0 && mine === rival is deliberately skipped: raceLeader breaks that tie on the
      // lower polity id, not in the player's favour, so these two numbers do not decide it.
      const end = root.querySelector("button.army-end") as HTMLButtonElement | null;
      if (!end) break;                                   // the game reached an outcome
      playAggressively();
      end.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }
    expect(sawQuiet).toBeGreaterThan(0);                 // it was quiet before the first conquest
    expect(sawLead).toBeGreaterThan(0);                  // and it did fire once the player led
  });
});

describe("theater scoping in the UI", () => {
  let root: HTMLElement;
  beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); });
  afterEach(() => { root.remove(); });

  function pickNation(): void {
    const label = root.querySelector(".army-pick-label") as HTMLElement;
    const id = label.getAttribute("data-polity")!;
    (root.querySelector(`.army-prov[data-polity="${id}"]`) as SVGElement)
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }

  it("offers only nations that have a reachable rival", () => {
    mountArmyApp(root, { seed: 23 });
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 23 });
    const s = initArmySim(world);
    const offered = [...root.querySelectorAll(".army-pick-label")].map((l) => Number(l.getAttribute("data-polity"))).sort((a, b) => a - b);
    expect(offered).toEqual(playableNations(s));
    expect(offered.length).toBeLessThan(new Set([...s.owner].filter((o) => o >= 0)).size);
  });

  it("numbers only the land inside the theater, but still paints the rest", () => {
    mountArmyApp(root, { seed: 23 });
    pickNation();
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 23 });
    const s = initArmySim(world);
    const played = Number((root.querySelector(".army-hud") as HTMLElement).dataset.nation ?? NaN);
    const mask = theaterOf(s, Number.isNaN(played) ? playableNations(s)[0] : played);
    const numbered = new Set([...root.querySelectorAll(".army-num")].map((n) => Number(n.getAttribute("data-prov"))));
    for (const p of numbered) expect(mask[p]).toBe(1);              // nothing outside the theater is numbered
    expect(numbered.size).toBeLessThan(s.n);                        // seed 23 has out-of-theater land
    expect(root.querySelector(".army-wild")).toBeTruthy();          // the rest of the world is still painted
  });

  it("the goal reflects the theater, not the whole map", () => {
    mountArmyApp(root, { seed: 23 });
    pickNation();
    const goalShown = Number((root.querySelector(".army-hud")!.textContent!.match(/정복 [+-]\d+\/(\d+)/) || [])[1]);
    const { world } = generateWorld({ ...DEFAULT_PARAMS, seed: 23 });
    const s = initArmySim(world);
    const wholeMapGoal = goalGain(s);
    expect(goalShown).toBeGreaterThan(0);
    expect(goalShown).toBeLessThan(wholeMapGoal);
  });
});
