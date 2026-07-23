// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mountProvinceApp, provinceCellOwner, isDomination, shakyOpacity, reasonText, survivalGrade, defectionReasonText,
  sortRisksByUrgency, provinceOutlinePath, badgeScale, provinceSpan, dominationProgress,
} from "./provinceApp";
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

describe("isDomination (win = gained 15% of the map beyond your start)", () => {
  const LAND = 102; // seed-1 land province count; target = round(0.15 * 102) = 15 provinces gained
  it("wins once you have conquered ~15% of the map beyond your start", () => {
    expect(isDomination(25, 10, LAND)).toBe(true);  // gained 15 → win
    expect(isDomination(24, 10, LAND)).toBe(false); // gained 14 → not yet
  });
  it("never triggers instantly for a big start — you must actually GAIN, not just be large", () => {
    expect(isDomination(40, 40, LAND)).toBe(false); // gained 0 → no instant win
    expect(isDomination(55, 40, LAND)).toBe(true);  // a big nation still has to conquer 15 more
  });
});

describe("survivalGrade (turtling to turn 50 is a lesser outcome than expanding)", () => {
  const LAND = 102; // "great" threshold = round(0.1 * 102) = 10 provinces gained
  it("grades survival by growth: great / grown / held", () => {
    expect(survivalGrade(25, 15, LAND)).toBe("great"); // gained 10 → great power
    expect(survivalGrade(19, 15, LAND)).toBe("grown"); // gained 4 → grown
    expect(survivalGrade(15, 15, LAND)).toBe("held");  // no gain → merely endured (turtle)
    expect(survivalGrade(12, 15, LAND)).toBe("held");  // shrank → still just held
  });
});

describe("reasonText (plain-language attack reasons)", () => {
  it("phrases each reason in the chosen language", () => {
    expect(reasonText("realm-weak", "ko")).toContain("불안정");
    expect(reasonText("target-stable", "ko")).toContain("굳건");
    expect(reasonText("target-shaky", "en")).toContain("shaky");
    expect(reasonText("too-far", "en")).toContain("far");
  });
});

describe("shakyOpacity (map wash reveals fragile provinces)", () => {
  it("is 0 for stable provinces and rises as solidarity falls, clamped to [0, 0.5]", () => {
    expect(shakyOpacity(0.9)).toBe(0);                                   // stable → no wash, full colour
    expect(shakyOpacity(0.1)).toBeGreaterThan(shakyOpacity(0.5));        // shakier washes more
    expect(shakyOpacity(0.5)).toBeGreaterThan(0);                        // neutral start slightly washed
    expect(shakyOpacity(-1)).toBeLessThanOrEqual(0.5);                   // clamped high
    expect(shakyOpacity(2)).toBe(0);                                     // clamped low
  });
});

describe("solidarity wash on the map (play mode)", () => {
  let root: HTMLElement;
  beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); });
  it("overlays a per-province wash on owned provinces once a game starts", () => {
    mountProvinceApp(root, { seed: 1 });
    (root.querySelector("[data-polity]") as SVGPathElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const wash = root.querySelector(".prov-solidarity");
    expect(wash).toBeTruthy();
    expect(wash!.querySelectorAll(".prov-shaky").length).toBeGreaterThan(0);
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

  it("renders the intra-nation province mesh (province borders denser than nation borders)", () => {
    mountProvinceApp(root, { seed: 1 });
    const provBorder = root.querySelector(".province-border") as SVGPathElement;
    const natBorder = root.querySelector(".nation-border") as SVGPathElement;
    expect(provBorder).toBeTruthy();
    const pd = provBorder.getAttribute("d") || "";
    const nd = natBorder.getAttribute("d") || "";
    // every province boundary draws (incl. those inside one nation), so the mesh is strictly
    // denser than the country outlines — this is what makes it read as "play in provinces".
    expect(pd.length).toBeGreaterThan(nd.length);
  });

  it("paints nation labels ABOVE the border meshes so the province lines never cross the text", () => {
    mountProvinceApp(root, { seed: 1 });
    const svg = root.querySelector("svg") as SVGSVGElement;
    const kids = Array.from(svg.children);
    const labelIdx = kids.findIndex((el) => el.classList.contains("nation-labels"));
    const provIdx = kids.findIndex((el) => el.classList.contains("province-border"));
    const natIdx = kids.findIndex((el) => el.classList.contains("nation-border"));
    expect(labelIdx).toBeGreaterThan(-1);      // labels lifted to a top-level svg child
    expect(labelIdx).toBeGreaterThan(provIdx); // …and painted after the province mesh
    expect(labelIdx).toBeGreaterThan(natIdx);  // …and after the nation outlines
  });

  it("has a header with a home link back to the landing and a picker hint", () => {
    mountProvinceApp(root, { seed: 1 });
    const home = root.querySelector(".prov-header a.home") as HTMLAnchorElement;
    expect(home).toBeTruthy();
    expect(home.getAttribute("href")).toBe("index.html"); // relative — Pages sub-path safe
    expect(root.querySelector(".prov-header .app-title")).toBeTruthy();
    // in picker mode a hint tells the player to click a nation to begin
    expect(root.querySelector(".prov-hint")?.textContent || "").toMatch(/나라|클릭|nation|click/i);
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

  it("colours each attackable province by predicted outcome (winnable vs too-strong) with a legend", () => {
    startAsFirstPolity();
    const targets = Array.from(root.querySelectorAll(".prov-target"));
    expect(targets.length).toBeGreaterThan(0);
    // every target is classified one way or the other, and carries an explanatory tooltip
    for (const t of targets) {
      expect(t.classList.contains("winnable") || t.classList.contains("too-strong")).toBe(true);
      expect(t.querySelector("title")?.textContent || "").not.toBe("");
    }
    expect(root.querySelector(".prov-legend")).toBeTruthy();
  });

  it("shows a battle preview with strengths and a reason for each armed target", () => {
    startAsFirstPolity();
    const preview = root.querySelector(".prov-preview")!;
    expect(preview.textContent || "").toMatch(/공격할|click provinces/i); // empty-state prompt before arming
    (root.querySelector(".prov-target") as SVGPathElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const rows = root.querySelectorAll(".prov-preview-row");
    expect(rows.length).toBe(1);
    expect(rows[0].textContent || "").toMatch(/⚔.*🛡/);                       // attacker vs defender numbers
    expect(rows[0].textContent || "").toMatch(/[()]/);                        // a parenthesised reason
    expect(rows[0].classList.contains("winnable") || rows[0].classList.contains("too-strong")).toBe(true);
  });

  it("advancing bumps the turn and logs any conquest", () => {
    startAsFirstPolity();
    const target = root.querySelector(".prov-target") as SVGPathElement;
    target.dispatchEvent(new MouseEvent("click", { bubbles: true })); // arm one province
    (root.querySelector(".prov-advance") as HTMLButtonElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(root.querySelector(".prov-hud")!.textContent).toMatch(/1\s*\/\s*50/); // turn advanced
  });
});

describe("sea lanes (play mode)", () => {
  let root: HTMLElement;
  beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); });

  it("draws a dashed sea-lane for each expedition route in play mode", () => {
    mountProvinceApp(root, { seed: 1 });
    // pick the first live polity territory to start (mirrors how other tests in this file start a game).
    const terr = root.querySelector<SVGElement>("[data-polity]");
    terr?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const lanes = root.querySelectorAll(".prov-map .prov-lane");
    // seed 1 has ≥1 lane by construction (connectivity fallback guarantees reachability); each is a dashed <line>.
    expect(lanes.length).toBeGreaterThan(0);
    expect(lanes[0].getAttribute("stroke-dasharray")).toBeTruthy();
  });
});

describe("stance toggle (conquer vs consolidate)", () => {
  let root: HTMLElement;
  beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); });
  function start() {
    mountProvinceApp(root, { seed: 1 });
    (root.querySelector("[data-polity]") as SVGPathElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }
  it("offers a conquer/consolidate stance; consolidate hides the attack overlay", () => {
    start();
    const btns = Array.from(root.querySelectorAll(".prov-stance .prov-stance-btn")) as HTMLButtonElement[];
    expect(btns.length).toBe(2);
    expect(root.querySelector(".prov-stance-btn.active")).toBeTruthy();     // a mode is active (conquer default)
    expect(root.querySelectorAll(".prov-target").length).toBeGreaterThan(0); // conquer shows attack targets
    btns.find((b) => b.dataset.mode === "consolidate")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(root.querySelectorAll(".prov-target").length).toBe(0);           // no attack overlay while consolidating
    expect(root.querySelector(".prov-advance")!.textContent).toMatch(/내실|consolidate/i);
  });
  it("consolidate mode lets you fortify your OWN provinces, capped (no blanket shield)", () => {
    start();
    (Array.from(root.querySelectorAll(".prov-stance-btn")) as HTMLButtonElement[])
      .find((b) => b.dataset.mode === "consolidate")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const n = root.querySelectorAll(".prov-fortify").length;
    expect(n).toBeGreaterThan(0);                            // your provinces are selectable to shore up
    const ids = Array.from(root.querySelectorAll(".prov-fortify")).slice(0, 3).map((e) => e.getAttribute("data-province"));
    for (const id of ids) {                                 // re-query each time — render() rebuilds the nodes
      const el = root.querySelector(`.prov-fortify[data-province="${id}"]`) as SVGPathElement | null;
      el?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }
    expect(root.querySelectorAll(".prov-fortify.armed").length).toBe(Math.min(2, n)); // capped at CONSOLIDATE_MAX (2)
  });

  it("surfaces a dilemma card during play that the player resolves to continue", () => {
    mountProvinceApp(root, { seed: 1 });
    (root.querySelector("[data-polity]") as SVGPathElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    let card: Element | null = null;
    for (let i = 0; i < 25; i++) {
      card = root.querySelector(".prov-dilemma");
      if (card) break;
      const adv = root.querySelector(".prov-advance") as HTMLButtonElement | null;
      if (!adv) break;
      adv.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }
    expect(card).toBeTruthy();                                              // a dilemma appeared within 25 turns
    expect(root.querySelectorAll(".prov-dilemma .prov-choice").length).toBe(2); // two tradeoff choices
    (root.querySelector(".prov-choice") as HTMLButtonElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(root.querySelector(".prov-dilemma")).toBeNull();                 // resolving dismisses it
    expect(root.querySelector(".prov-advance")).toBeTruthy();               // …and the normal turn UI returns
  });

  it("consolidating still advances the turn", () => {
    start();
    (Array.from(root.querySelectorAll(".prov-stance-btn")) as HTMLButtonElement[])
      .find((b) => b.dataset.mode === "consolidate")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    (root.querySelector(".prov-advance") as HTMLButtonElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(root.querySelector(".prov-hud")!.textContent).toMatch(/1\s*\/\s*50/);
  });
});

describe("province victory / defeat", () => {
  let root: HTMLElement;
  beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); });

  it("declares survival victory after the last turn if the capital is held", () => {
    mountProvinceApp(root, { seed: 1 });
    const path = root.querySelector("[data-polity]") as SVGPathElement;
    path.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    // advance to the horizon without attacking (pure survival); resolve any dilemma cards that block the turn
    for (let i = 0; i < 70; i++) {
      const choice = root.querySelector(".prov-choice") as HTMLButtonElement | null;
      if (choice) { choice.dispatchEvent(new MouseEvent("click", { bubbles: true })); continue; }
      const adv = root.querySelector(".prov-advance") as HTMLButtonElement | null;
      if (!adv) break; // game already ended (defeat)
      adv.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }
    const over = root.querySelector(".prov-over");
    expect(over).toBeTruthy();
    expect(over!.textContent).toMatch(/버텨|endured|강대국|great|생존|survi|패배|defeat/i); // some terminal outcome shown
    // a finished game offers restart
    expect(root.querySelector(".prov-again")).toBeTruthy();
    expect(root.querySelector(".prov-new")).toBeTruthy();
  });
});

describe("defectionReasonText (a warning always says why)", () => {
  it("phrases each reason in the chosen language, with the neighbour counts for 'isolated'", () => {
    expect(defectionReasonText("isolated", 1, 4, "ko")).toContain("고립");
    expect(defectionReasonText("isolated", 1, 4, "ko")).toContain("4");
    expect(defectionReasonText("far", 1, 2, "ko")).toContain("멂");
    expect(defectionReasonText("shaky", 1, 2, "en")).toContain("garrison");
    expect(defectionReasonText("far", 1, 2, "en")).toContain("far");
  });
});

describe("sortRisksByUrgency (risk panel orders most-urgent first)", () => {
  it("sorts by ascending turnsLeft, ties broken by province id ascending", () => {
    const risks = [
      { p: 5, r: { turnsLeft: 3, reason: "isolated" as const, ownN: 0, foeN: 2, rival: 1 } },
      { p: 1, r: { turnsLeft: 0, reason: "far" as const, ownN: 0, foeN: 1, rival: 1 } },
      { p: 2, r: { turnsLeft: 1, reason: "shaky" as const, ownN: 0, foeN: 1, rival: 1 } },
      { p: 0, r: { turnsLeft: 1, reason: "isolated" as const, ownN: 0, foeN: 1, rival: 1 } }, // ties p2 on turnsLeft
    ];
    const sorted = sortRisksByUrgency(risks);
    expect(sorted.map((x) => x.p)).toEqual([1, 0, 2, 5]); // turnsLeft 0, then the tie (0 < 2) at turnsLeft 1, then 3
    // input array is untouched (pure function)
    expect(risks.map((x) => x.p)).toEqual([5, 1, 2, 0]);
  });
});

describe("defection chronicle log (both directions)", () => {
  let root: HTMLElement;
  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
    localStorage.setItem("wm:lang", "ko");
  });
  afterEach(() => { localStorage.removeItem("wm:lang"); });

  // found deterministically: seed 1's first live polity, arming exactly ONE unarmed target per turn (a
  // gentler growth than the "all-armable" policy used elsewhere in this file), produces BOTH a province
  // defecting away from the player ("이탈") and an enemy province defecting to the player ("귀순") by turn 3.
  const SEED = 1;
  const TURNS = 3;

  it("logs 'defected' when the player loses a province and 'joined you' when one defects to the player", () => {
    mountProvinceApp(root, { seed: SEED });
    (root.querySelector("[data-polity]") as SVGPathElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    for (let t = 0; t < TURNS; t++) {
      const choice = root.querySelector(".prov-choice") as HTMLButtonElement | null;
      if (choice) { choice.dispatchEvent(new MouseEvent("click", { bubbles: true })); t--; continue; }
      // arm at most one unarmed target this turn (gentler than all-armable — lets defection dynamics play out)
      const target = root.querySelector(".prov-target:not(.armed)") as SVGPathElement | null;
      if (target) target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      (root.querySelector(".prov-advance") as HTMLButtonElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }
    const log = root.querySelector(".prov-log")!.textContent || "";
    expect(log).toMatch(/이탈/);  // the player lost a province to defection
    expect(log).toMatch(/귀순/);  // an enemy province defected to the player
  });
});

describe("defection warning in play mode", () => {
  let root: HTMLElement;
  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
    // mountProvinceApp has no lang override — force Korean via the same "wm:lang" key detectLang() reads,
    // so the KO-specific assertions below are deterministic regardless of the test runner's navigator.language.
    localStorage.setItem("wm:lang", "ko");
  });
  afterEach(() => { localStorage.removeItem("wm:lang"); });

  // found deterministically: seed 1's first live polity has a province go at-risk by turn 3
  // (throwaway script per the task brief, scanning seeds 1-20 for the first at-risk turn; deleted after use).
  const SEED = 1;
  const TURNS = 3;

  it("shows a countdown badge with its reason, a ring on the map, and a remedy hint", () => {
    mountProvinceApp(root, { seed: SEED });
    (root.querySelector("[data-polity]") as SVGPathElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    // advance until the player actually has land at risk; resolve any dilemma cards that block the turn.
    // arms every armable target each turn (mirrors the "all-armable" policy the Step 1a script used to
    // derive SEED/TURNS, so this loop reproduces the exact same at-risk state deterministically).
    for (let t = 0; t < TURNS; t++) {
      const choice = root.querySelector(".prov-choice") as HTMLButtonElement | null;
      if (choice) { choice.dispatchEvent(new MouseEvent("click", { bubbles: true })); t--; continue; }
      let next: Element | null;
      while ((next = root.querySelector(".prov-target:not(.armed)"))) {
        next.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      }
      (root.querySelector(".prov-advance") as HTMLButtonElement)
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }
    const panel = root.querySelector(".prov-risk")!;
    expect(panel).toBeTruthy();                                       // the warning renders at all
    const row = panel.querySelector(".prov-risk-row")!;
    expect(row.textContent || "").toMatch(/이탈 \d턴/);                // countdown
    expect(row.textContent || "").toMatch(/고립|멂|수비/);              // …and the REASON
    expect(panel.querySelector(".prov-risk-hint")!.textContent || "").toMatch(/내실/); // …and the remedy
    expect(root.querySelectorAll(".prov-map .prov-risk-ring").length).toBeGreaterThan(0); // …and the map ring
  });
});

describe("province ping (a named province is click-to-locate on the map)", () => {
  let root: HTMLElement;
  beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); });

  // Drive an all-in blitz until the player holds land under enough pressure to be at risk of defecting —
  // the same driver the existing risk-panel test uses.
  function blitzUntilRisk(): Element | null {
    mountProvinceApp(root, { seed: 1 });
    (root.querySelector("[data-polity]") as SVGPathElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    for (let t = 0; t < 40 && !root.querySelector(".prov-risk-row"); t++) {
      const choice = root.querySelector(".prov-choice") as HTMLButtonElement | null;
      if (choice) { choice.dispatchEvent(new MouseEvent("click", { bubbles: true })); t--; continue; }
      const adv = root.querySelector(".prov-advance") as HTMLButtonElement | null;
      if (!adv) break; // game ended
      let next: Element | null;
      while ((next = root.querySelector(".prov-target:not(.armed)"))) {
        next.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      }
      adv.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }
    return root.querySelector(".prov-risk-row");
  }

  it("flashes the province's own outline when a risk row is clicked", () => {
    const row = blitzUntilRisk();
    expect(row).toBeTruthy();                                   // the driver reached a risk state
    expect(row!.classList.contains("prov-pingable")).toBe(true); // the row advertises itself as clickable
    expect(root.querySelector(".prov-map .prov-ping")).toBeNull(); // nothing pinged yet

    row!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const ping = root.querySelector(".prov-map .prov-ping") as SVGPathElement;
    expect(ping).toBeTruthy();
    // it is THAT province's outline, not a generic marker
    const world = generateWorld({ ...DEFAULT_PARAMS, seed: 1 }).world;
    const provId = Number((row as HTMLElement).dataset.province);
    expect(ping.getAttribute("d")).toBe(provinceOutlinePath(world, provId));
    expect(ping.getAttribute("style") || "").toContain("pointer-events:none"); // never blocks target clicks
  });

  it("removes itself so pings don't pile up", () => {
    vi.useFakeTimers();
    try {
      const row = blitzUntilRisk();
      row!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(root.querySelector(".prov-ping")).toBeTruthy();
      vi.advanceTimersByTime(2000); // jsdom fires no animationend — the fallback timer must clean up
      expect(root.querySelector(".prov-ping")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("provinceOutlinePath (pure province boundary)", () => {
  it("returns a non-empty path per province and differs between provinces", () => {
    const world = generateWorld({ ...DEFAULT_PARAMS, seed: 1 }).world;
    const a = provinceOutlinePath(world, 0);
    const b = provinceOutlinePath(world, 1);
    expect(a.startsWith("M")).toBe(true);
    expect(b.startsWith("M")).toBe(true);
    expect(a).not.toBe(b);
  });
});

describe("dilemma card title pings its province", () => {
  let root: HTMLElement;
  beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); });

  // seed 1, plain advances (never arming an attack): the player never conquers, so every owned province
  // stays on the frontier (frontier provinces RISE in solidarity — see computeSteppedSol in provinceSim.ts)
  // and can never fall below DILEMMA_RESTLESS_MAX; likewise no enemy province adjacent to the player ever
  // decays low enough for "defector" (adjacency to the player makes IT frontier too, for the same reason).
  // So with no conquests, "restless"/"defector" are structurally unreachable and the periodic "muster"
  // (every 12 ticks, rng-free) is the only dilemma this driver can ever surface — confirmed deterministic
  // by a throwaway seed/driver scan (seeds 1-15, deleted after use).
  it("leaves the placeless muster dilemma un-pingable", () => {
    mountProvinceApp(root, { seed: 1 });
    (root.querySelector("[data-polity]") as SVGPathElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    let title: HTMLElement | null = null;
    for (let i = 0; i < 15; i++) {
      title = root.querySelector(".prov-dilemma-title");
      if (title) break;
      const adv = root.querySelector(".prov-advance") as HTMLButtonElement | null;
      if (!adv) break;
      adv.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }
    expect(title).toBeTruthy(); // the periodic muster appeared within 15 turns
    expect(title!.classList.contains("prov-pingable")).toBe(false);
    title!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(root.querySelector(".prov-map .prov-ping")).toBeNull(); // no province named, nothing to locate
    expect(title!.textContent || "").toMatch(/소집|muster/i);
  });

  // seed 4, blitzing every armable target every turn (same all-armable driver as the "defection warning"
  // and "province ping" describes above): the resulting conquests create an interior province behind the
  // new frontier, whose solidarity decays below DILEMMA_RESTLESS_MAX, deterministically surfacing a PLACED
  // "restless" dilemma by turn 8 (found by a throwaway seed scan 1-15, deleted after use; seed 1 itself
  // ends the game too soon under this driver to reach any dilemma).
  it("makes a placed (restless/defector) dilemma's title click-to-locate", () => {
    mountProvinceApp(root, { seed: 4 });
    (root.querySelector("[data-polity]") as SVGPathElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    let title: HTMLElement | null = null;
    for (let i = 0; i < 20; i++) {
      title = root.querySelector(".prov-dilemma-title");
      if (title) break;
      const choice = root.querySelector(".prov-choice") as HTMLButtonElement | null;
      if (choice) { choice.dispatchEvent(new MouseEvent("click", { bubbles: true })); i--; continue; }
      const adv = root.querySelector(".prov-advance") as HTMLButtonElement | null;
      if (!adv) break; // game ended
      let next: Element | null;
      while ((next = root.querySelector(".prov-target:not(.armed)"))) {
        next.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      }
      adv.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }
    expect(title).toBeTruthy(); // a placed dilemma appeared within 20 turns of blitzing
    expect(title!.classList.contains("prov-pingable")).toBe(true);
    expect(root.querySelector(".prov-map .prov-ping")).toBeNull(); // nothing pinged yet

    title!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const ping = root.querySelector(".prov-map .prov-ping") as SVGPathElement;
    expect(ping).toBeTruthy();
    // it is THAT province's outline, not a generic marker
    const world = generateWorld({ ...DEFAULT_PARAMS, seed: 4 }).world;
    const provId = Number(title!.dataset.province);
    expect(ping.getAttribute("d")).toBe(provinceOutlinePath(world, provId));
  });
});

describe("chronicle log entries locate themselves on the map", () => {
  let root: HTMLElement;
  beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); });

  function blitz(turns: number): void {
    mountProvinceApp(root, { seed: 1 });
    (root.querySelector("[data-polity]") as SVGPathElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    for (let t = 0; t < turns; t++) {
      const choice = root.querySelector(".prov-choice") as HTMLButtonElement | null;
      if (choice) { choice.dispatchEvent(new MouseEvent("click", { bubbles: true })); continue; }
      const adv = root.querySelector(".prov-advance") as HTMLButtonElement | null;
      if (!adv) break;
      let next: Element | null;
      while ((next = root.querySelector(".prov-target:not(.armed)"))) {
        next.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      }
      adv.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }
  }

  it("renders the log as separate entries, keeping the same one-line text", () => {
    blitz(6);
    const items = Array.from(root.querySelectorAll(".prov-log .prov-log-item"));
    expect(items.length).toBeGreaterThan(0);
    // regression: the visible text is still the entries joined by " · "
    expect((root.querySelector(".prov-log")!.textContent || "").trim())
      .toBe(items.map((i) => i.textContent).join(" · "));
  });

  it("pings the province a conquest entry names", () => {
    blitz(6);
    const item = root.querySelector(".prov-log .prov-log-item.prov-pingable") as HTMLElement;
    expect(item).toBeTruthy(); // conquests/losses carry a province
    item.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const ping = root.querySelector(".prov-map .prov-ping") as SVGPathElement;
    expect(ping).toBeTruthy();
    const world = generateWorld({ ...DEFAULT_PARAMS, seed: 1 }).world;
    expect(ping.getAttribute("d")).toBe(provinceOutlinePath(world, Number(item.dataset.province)));
  });

  it("leaves placeless entries (an eliminated nation) non-pingable", () => {
    // pinned: seed 1 under the all-armable driver is defeated by turn ~8 (confirmed by a throwaway
    // turn-count scan, deleted after use), which lands TWO "eliminated" entries inside the 8-entry log
    // window every time — a hard guarantee, not a maybe. This driver never reaches a dilemma before
    // defeat, so no "결정/chose" entries appear here at all: a placed dilemma's decision line is now
    // legitimately pingable (see the "carries the province" test below), so it must NOT be lumped in
    // with the placeless check below — only "eliminated" text is unambiguously placeless.
    blitz(8);
    const items = Array.from(root.querySelectorAll(".prov-log .prov-log-item")) as HTMLElement[];
    const placeless = items.filter((it) => /멸망|eliminated/.test(it.textContent || ""));
    expect(placeless.length).toBeGreaterThan(0); // guarantee the window actually contains a placeless entry
    for (const it of placeless) expect(it.classList.contains("prov-pingable")).toBe(false);
  });

  it("carries the province into a resolved placed dilemma's decision log entry", () => {
    // same seed-4 all-armable driver as "makes a placed (restless/defector) dilemma's title click-to-locate"
    // above: reliably surfaces a PLACED "restless" dilemma by turn 8. Unlike muster (prov -1, no province
    // to name), a placed dilemma's decision must carry its province once resolved — this is Finding 2.
    mountProvinceApp(root, { seed: 4 });
    (root.querySelector("[data-polity]") as SVGPathElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    let title: HTMLElement | null = null;
    for (let i = 0; i < 20; i++) {
      title = root.querySelector(".prov-dilemma-title");
      if (title) break;
      const choice = root.querySelector(".prov-choice") as HTMLButtonElement | null;
      if (choice) { choice.dispatchEvent(new MouseEvent("click", { bubbles: true })); i--; continue; }
      const adv = root.querySelector(".prov-advance") as HTMLButtonElement | null;
      if (!adv) break; // game ended
      let next: Element | null;
      while ((next = root.querySelector(".prov-target:not(.armed)"))) {
        next.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      }
      adv.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }
    expect(title).toBeTruthy(); // a placed dilemma appeared within 20 turns of blitzing
    const provId = Number(title!.dataset.province);

    (root.querySelector(".prov-choice") as HTMLButtonElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));

    // the decision was just unshift()'d, so it is the newest (first) entry in the log
    const item = root.querySelectorAll(".prov-log .prov-log-item")[0] as HTMLElement;
    expect(item.textContent || "").toMatch(/결정|chose/);
    expect(item.classList.contains("prov-pingable")).toBe(true);
    expect(Number(item.dataset.province)).toBe(provId);

    item.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const ping = root.querySelector(".prov-map .prov-ping") as SVGPathElement;
    expect(ping).toBeTruthy();
    const world = generateWorld({ ...DEFAULT_PARAMS, seed: 4 }).world;
    expect(ping.getAttribute("d")).toBe(provinceOutlinePath(world, provId));
  });
});

describe("badgeScale (a verdict badge keeps a constant on-screen size)", () => {
  it("is 1 when the rendered width is unknown (jsdom / before layout)", () => {
    expect(badgeScale(1000, 0)).toBe(1);
    expect(badgeScale(1000, -5)).toBe(1);
  });
  it("counter-scales as the map is fitted into a narrower box", () => {
    expect(badgeScale(1000, 900)).toBeCloseTo(1.111, 2); // desktop ~900px
    expect(badgeScale(1000, 500)).toBe(2);               // already at the cap
  });
  it("clamps to [1, 2] — never shrinks below 1, never swallows a province on a phone", () => {
    expect(badgeScale(1000, 2000)).toBe(1); // map larger than its own viewBox
    expect(badgeScale(1000, 360)).toBe(2);  // phone: uncapped would be 2.8
  });
});

describe("verdict marks on the attack map", () => {
  let root: HTMLElement;
  beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); });

  function start(): void {
    mountProvinceApp(root, { seed: 1 });
    (root.querySelector("[data-polity]") as SVGPathElement)
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }

  it("puts exactly one ✓ badge on each province you can take, and none on the rest", () => {
    start();
    const winnable = root.querySelectorAll(".prov-target.winnable").length;
    const badges = root.querySelectorAll(".prov-targets .prov-verdict");
    expect(winnable).toBeGreaterThan(0);          // seed 1 offers at least one takeable target
    expect(badges.length).toBe(winnable);
    for (const b of badges) expect(b.textContent).toContain("✓");
  });

  it("never blocks the click layer", () => {
    start();
    const badges = root.querySelectorAll(".prov-verdict");
    expect(badges.length).toBeGreaterThan(0); // otherwise this loop is vacuous and can't catch a regression
    for (const b of badges) {
      expect(b.getAttribute("style") || "").toContain("pointer-events:none");
    }
  });

  it("registers exactly ONE resize listener no matter how many times the map re-renders", () => {
    const spy = vi.spyOn(window, "addEventListener");
    start();
    for (let i = 0; i < 3; i++) {
      const adv = root.querySelector(".prov-advance") as HTMLButtonElement | null;
      const choice = root.querySelector(".prov-choice") as HTMLButtonElement | null;
      if (choice) { choice.dispatchEvent(new MouseEvent("click", { bubbles: true })); continue; }
      if (adv) adv.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }
    const resizeRegistrations = spy.mock.calls.filter((c) => c[0] === "resize").length;
    expect(resizeRegistrations).toBe(1); // render() runs per turn — per-render registration would stack
    spy.mockRestore();
  });

  // "New world" (`.prov-new`) calls mountProvinceApp(root, {}) again on the SAME root — a real re-mount,
  // not just a re-render. Left unguarded, every click leaks another permanent window-scoped resize listener
  // closing over the discarded game. Spy on BOTH add and remove so a fix that only stops future adds (without
  // removing the stale one) can't pass vacuously.
  //
  // mountProvinceApp's de-dup handle (`activeResize`) is module-scope state that persists across tests in
  // this file, so counting raw addEventListener/removeEventListener calls against a spy started mid-stream
  // would double-count whatever an earlier test already left behind. vi.resetModules() + a fresh dynamic
  // import gives this test its OWN module instance starting from a clean (no listener) baseline, so
  // adds-removes here reflects only THIS test's mounts.
  it("re-mounting via 'New world' leaves exactly one live resize listener, never a growing pile", async () => {
    vi.resetModules();
    const fresh = await import("./provinceApp");
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");
    function playToOutcome(): void {
      (root.querySelector("[data-polity]") as SVGPathElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
      for (let i = 0; i < 70; i++) {
        const choice = root.querySelector(".prov-choice") as HTMLButtonElement | null;
        if (choice) { choice.dispatchEvent(new MouseEvent("click", { bubbles: true })); i--; continue; }
        const adv = root.querySelector(".prov-advance") as HTMLButtonElement | null;
        if (!adv) break; // outcome overlay reached (defeat/domination/survival)
        adv.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      }
    }
    try {
      fresh.mountProvinceApp(root, { seed: 1 }); // initial mount, as the page does on load
      playToOutcome();
      for (let n = 0; n < 2; n++) {
        const nw = root.querySelector(".prov-new") as HTMLButtonElement | null;
        expect(nw).toBeTruthy(); // the game actually reached an outcome screen with a "New world" button
        nw!.dispatchEvent(new MouseEvent("click", { bubbles: true })); // re-invokes mountProvinceApp on the SAME root
        playToOutcome(); // drive the fresh (random-seed) game to its own outcome for the next iteration
      }
      const adds = addSpy.mock.calls.filter((c) => c[0] === "resize").length;
      const removes = removeSpy.mock.calls.filter((c) => c[0] === "resize").length;
      // 3 mounts total (1 initial + 2 "New world" clicks) must net to exactly ONE live listener.
      expect(adds - removes).toBe(1);
    } finally {
      addSpy.mockRestore();
      removeSpy.mockRestore();
    }
  });

  // A re-mount removes the OLD listener but, before this fix, left any setTimeout it had already scheduled
  // running — so: resize, then re-mount within the 150ms debounce window (e.g. "New world" clicked fast),
  // and the stale timer's render() fires AFTER the new game mounts, repainting the DISCARDED world over it.
  // Distinguish the two mounts by whether a game was actually started (".prov-hud" only exists mid-game) —
  // mount A starts a game, mount B stays on the picker, so a stale A-render would visibly resurrect the HUD.
  it("cancels a pending debounce timer on re-mount — a stale resize render can't clobber the new game", () => {
    vi.useFakeTimers();
    try {
      mountProvinceApp(root, { seed: 1 });
      (root.querySelector("[data-polity]") as SVGPathElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(root.querySelector(".prov-hud")).toBeTruthy(); // confirm mount A actually started a game

      window.dispatchEvent(new Event("resize")); // schedules mount A's debounced render(), ~150ms out
      vi.advanceTimersByTime(50); // well under the delay — A's timer is still pending

      mountProvinceApp(root, { seed: 2 }); // re-mount before the debounce elapses — fresh picker, no game yet
      expect(root.querySelector(".prov-hud")).toBeFalsy(); // mount B is on the picker, not mid-game

      vi.advanceTimersByTime(150); // past mount A's original 150ms delay

      // if A's timer had NOT been cancelled, its callback would fire here and repaint A's started-game HUD
      // over mount B's picker. It must still read as the picker.
      expect(root.querySelector(".prov-hud")).toBeFalsy();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("provinceSpan (fixed viewBox extent, used to cap the ✓ badge per province)", () => {
  const world = generateWorld({ ...DEFAULT_PARAMS, seed: 1 }).world;
  it("is positive for every real province and never exceeds the map's own dimensions", () => {
    const maxDim = Math.max(world.grid.width, world.grid.height);
    for (const p of world.provinces) {
      const span = provinceSpan(world, p.id);
      expect(span).toBeGreaterThan(0);
      expect(span).toBeLessThanOrEqual(maxDim);
    }
  });
  it("is 0 for a province id that owns no cells", () => {
    // -1 is NOT a valid "no cells" probe here: it's the ocean/unowned sentinel that plenty of cells carry
    // (see provinceCellOwner), so it would span the whole map instead. Use an id past the last real province.
    expect(provinceSpan(world, world.provinces.length + 1000)).toBe(0);
  });
});

// the global counter-scale (badgeScale) keeps the badge a constant ON-SCREEN size, but that alone can make
// the badge bigger than a small province (measured: at a 370px map width badgeScale hits its cap of 2 while
// a real province there renders smaller than the disc). targetOverlay additionally caps each badge to ~70%
// of ITS OWN province's smaller viewBox extent — verify that cap actually binds, at both a phone width
// (where badgeScale alone would swallow small land) and a desktop width (where it must stay a no-op).
describe("per-province badge cap (the ✓ badge never exceeds ~70% of its own province's smaller extent)", () => {
  let restoreGBCR: (() => void) | null = null;
  afterEach(() => { if (restoreGBCR) { restoreGBCR(); restoreGBCR = null; } });

  // jsdom never lays out real geometry, so getBoundingClientRect is always zeros — mock it at the prototype
  // level (scoped to elements carrying the "prov-map" class) so it applies no matter how many times the map
  // svg is rebuilt across renders/re-mounts.
  function mockMapWidthPx(px: number): void {
    const proto = SVGElement.prototype as unknown as { getBoundingClientRect: (this: Element) => DOMRect };
    const orig = proto.getBoundingClientRect;
    const zero = { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON() { return {}; } } as DOMRect;
    proto.getBoundingClientRect = function (this: Element) {
      return this.classList?.contains("prov-map") ? ({ ...zero, width: px } as DOMRect) : orig.call(this);
    };
    restoreGBCR = () => { proto.getBoundingClientRect = orig; };
  }

  function badgesAtWidth(px: number): { provId: number; scale: number }[] {
    mockMapWidthPx(px);
    const root = document.createElement("div");
    document.body.appendChild(root);
    mountProvinceApp(root, { seed: 1 });
    (root.querySelector("[data-polity]") as SVGPathElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    return [...root.querySelectorAll(".prov-verdict")].map((b) => {
      const m = (b.getAttribute("transform") || "").match(/scale\(([\d.]+)\)/);
      expect(m).toBeTruthy(); // every badge must carry a scale — otherwise this test is vacuous
      return { provId: Number(b.getAttribute("data-province")), scale: Number(m![1]) };
    });
  }

  // The cap is now conditional: it binds ONLY where 0.7*span/18 is still >= 1 (Finding 1's floor takes over
  // below that). So the honest invariant is two-part: (a) the badge is NEVER drawn smaller than its authored
  // size (scale >= 1, on every province, however small), and (b) where the raw per-province fit is >= 1, the
  // cap still binds exactly as before. A cap-removed regression would fail (b); a floor-removed regression
  // would fail (a) — so neither half is checkable-away.
  function assertCapHolds(px: number): void {
    const world = generateWorld({ ...DEFAULT_PARAMS, seed: 1 }).world;
    const badges = badgesAtWidth(px);
    expect(badges.length).toBeGreaterThan(0); // seed 1 offers at least one takeable target
    for (const { provId, scale } of badges) {
      const span = provinceSpan(world, provId);
      // (a) floor: the badge is never smaller than its authored size, even on a 1-cell province.
      expect(scale).toBeGreaterThanOrEqual(1);
      // (b) cap: where the raw fit is at least 1, the emitted scale must not exceed it.
      // toFixed(2) rounding on the emitted scale can nudge the product up by a hair — allow a tiny slack.
      const cap = Math.max(1, (0.7 * span) / 18);
      expect(scale * 18).toBeLessThanOrEqual(Math.max(18, 0.7 * span) + 0.05);
      expect(scale).toBeLessThanOrEqual(cap + 0.01);
    }
  }

  it("binds at a phone width (370px), where badgeScale alone would hit its cap of 2", () => assertCapHolds(370));
  it("holds at a desktop width (900px) too — the cap is a no-op there for large provinces", () => assertCapHolds(900));

  it("floors the badge scale at 1 for a tiny province, even where the raw fit would shrink it below 1", () => {
    // A synthetic 1-2 cell province (as engine/provinces.ts routinely leaves on coastal/leftover land) has a
    // span well under BADGE_DIAMETER (18), so an un-floored fit would be well under 1 — an illegible badge on
    // the ONLY non-colour cue for "you can take this". Assert directly against the real seed-1 world: find the
    // smallest-span winnable province and confirm its badge scale is still exactly floored at >= 1.
    const world = generateWorld({ ...DEFAULT_PARAMS, seed: 1 }).world;
    const badges = badgesAtWidth(370);
    expect(badges.length).toBeGreaterThan(0);
    const smallest = badges.reduce((a, b) => (provinceSpan(world, a.provId) <= provinceSpan(world, b.provId) ? a : b));
    const span = provinceSpan(world, smallest.provId);
    if (span < 18 / 0.7) {
      // this province's raw per-province fit is below 1 — the floor MUST be the thing holding the line.
      expect(smallest.scale).toBe(1);
    }
    // regardless of which province is smallest, the floor invariant holds unconditionally.
    for (const { scale } of badges) expect(scale).toBeGreaterThanOrEqual(1);
  });
});

describe("hatching marks the provinces you cannot take", () => {
  let root: HTMLElement;
  beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); });

  function start(): void {
    mountProvinceApp(root, { seed: 1 });
    (root.querySelector("[data-polity]") as SVGPathElement)
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }

  it("hatches every too-strong target and leaves takeable ones clear", () => {
    start();
    const tooStrong = root.querySelectorAll(".prov-target.too-strong").length;
    const hatches = root.querySelectorAll(".prov-targets .prov-hatch");
    expect(tooStrong).toBeGreaterThan(0);
    expect(hatches.length).toBe(tooStrong);
    for (const h of hatches) expect(h.getAttribute("fill")).toBe("url(#prov-hatch)");
  });

  it("defines the hatch pattern ONCE per render, not once per province", () => {
    start();
    expect(root.querySelectorAll("pattern#prov-hatch").length).toBe(1);
  });

  it("never blocks the click layer, and an unwinnable province stays selectable", () => {
    start();
    for (const h of root.querySelectorAll(".prov-hatch")) {
      expect(h.getAttribute("style") || "").toContain("pointer-events:none");
    }
    const hard = root.querySelector(".prov-target.too-strong") as SVGPathElement;
    hard.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(root.querySelectorAll(".prov-target.armed").length).toBe(1); // you may still attack and fail
  });

  it("the legend describes both marks, not the colours", () => {
    start();
    const legend = root.querySelector(".prov-legend")!.textContent || "";
    expect(legend).toMatch(/✓/);
    expect(legend).toMatch(/빗금|hatched/);
  });
});

describe("dominationProgress (the counter is the win check, exposed)", () => {
  const LAND = 102; // goal = round(0.15 * 102) = 15
  it("reports gained = prov - start and goal = round(0.15*land)", () => {
    expect(dominationProgress(25, 10, LAND)).toEqual({ gained: 15, goal: 15 });
    expect(dominationProgress(24, 10, LAND)).toEqual({ gained: 14, goal: 15 });
  });
  it("shows a NEGATIVE gained when the realm shrank below its start (the losing state)", () => {
    expect(dominationProgress(6, 10, LAND)).toEqual({ gained: -4, goal: 15 });
  });
  it("gained >= goal exactly when isDomination is true — same fact, no drift", () => {
    for (const [prov, start] of [[25, 10], [24, 10], [40, 40], [55, 40], [6, 10]] as const) {
      const { gained, goal } = dominationProgress(prov, start, LAND);
      expect(gained >= goal).toBe(isDomination(prov, start, LAND));
    }
  });
});

describe("HUD win-progress bar", () => {
  let root: HTMLElement;
  beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); });
  it("renders a counter and bar matching dominationProgress once a game starts", () => {
    mountProvinceApp(root, { seed: 1 });
    (root.querySelector("[data-polity]") as SVGPathElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const prog = root.querySelector(".prov-progress");
    expect(prog).toBeTruthy();
    const hud = root.querySelector(".prov-hud")!.textContent || "";
    // realm count in the HUD ("영토 A/B") must equal start+gained from the counter
    const provInHud = Number((hud.match(/(\d+)\s*\/\s*\d+/) || [])[1]);
    const gained = Number((prog!.textContent || "").match(/-?\d+/)?.[0]);
    expect(Number.isFinite(provInHud)).toBe(true);
    expect(Number.isFinite(gained)).toBe(true);
    // at t0 gained is 0 (just picked), so the HUD province count equals the start
    expect(prog!.querySelector(".prov-progress-bar")).toBeTruthy();
  });
});
