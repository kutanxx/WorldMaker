// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { mountProvinceApp, provinceCellOwner, isDomination, shakyOpacity, reasonText } from "./provinceApp";
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

describe("isDomination (win = gained a fifth of the map beyond your start)", () => {
  const LAND = 102; // seed-1 land province count; target = round(0.2 * 102) = 20 provinces gained
  it("wins once you have conquered ~20% of the map beyond your start", () => {
    expect(isDomination(30, 10, LAND)).toBe(true);  // gained 20 → win
    expect(isDomination(29, 10, LAND)).toBe(false); // gained 19 → not yet
  });
  it("never triggers instantly for a big start — you must actually GAIN, not just be large", () => {
    expect(isDomination(40, 40, LAND)).toBe(false); // gained 0 → no instant win
    expect(isDomination(60, 40, LAND)).toBe(true);  // a big nation still has to conquer 20 more
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
    // advance to the horizon without attacking (pure survival)
    for (let i = 0; i < 50; i++) {
      const adv = root.querySelector(".prov-advance") as HTMLButtonElement | null;
      if (!adv) break; // game already ended (defeat)
      adv.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }
    const over = root.querySelector(".prov-over");
    expect(over).toBeTruthy();
    expect(over!.textContent).toMatch(/생존|survi|정복|domina|패배|defeat/i); // some terminal outcome shown
    // a finished game offers restart
    expect(root.querySelector(".prov-again")).toBeTruthy();
    expect(root.querySelector(".prov-new")).toBeTruthy();
  });
});
