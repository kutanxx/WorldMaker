// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mountFrontApp, paintPlan, clickTarget, playerFronts, leadingRival } from "./frontApp";
import { generateWorld } from "../engine/world";
import { DEFAULT_PARAMS } from "../types/world";
import {
  initFrontSim, setOwner, SEA, UNOWNED, TICK_HZ, tick, outcome, goalGain, startAttack,
} from "../engine/frontSim";
import { nationColor, PLAYER_COLOR } from "./nationPalette";

// vitest hoists this above the imports above; it wraps the real `tick` so calls can be counted
// without changing its behaviour. Both frontApp.ts and this file resolve the same mocked module, so
// counting calls here also counts the ticks the mounted app's own animation loop performs.
vi.mock("../engine/frontSim", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../engine/frontSim")>();
  return { ...actual, tick: vi.fn(actual.tick) };
});

describe("frontApp", () => {
  let root: HTMLElement;
  // mountFrontApp starts a real animation loop (jsdom's requestAnimationFrame genuinely fires on a
  // timer); leaving one running after a test finishes would keep ticking a detached DOM forever, for
  // the rest of the whole test run. Every test that mounts must capture and stop it.
  let dispose: (() => void) | undefined;
  beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); dispose = undefined; (tick as any).mockClear?.(); });
  afterEach(() => { dispose?.(); root.remove(); });

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
    // Not just "distinct from its neighbours" — specifically the app-wide reserved player colour,
    // the same one playApp.ts and provinceApp.ts use. A plain nationColor(player) lookup would also
    // satisfy the assertions above (every palette entry is already distinct), so pin the exact value.
    expect(fill(mine)).toBe(PLAYER_COLOR);
    expect(fill(mine)).not.toBe(nationColor(player));
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
    dispose = mountFrontApp(root, { seed: 11 });
    expect(root.querySelector("canvas.front-map")).toBeTruthy();
    const hud = root.querySelector(".front-hud")!;
    expect(hud.textContent).toMatch(/\d/);
    expect(root.querySelector("input.front-commit")).toBeTruthy();
  });

  it("shows the pool against the cap, and the commit slider in both percent and troops", () => {
    dispose = mountFrontApp(root, { seed: 11 });
    const hud = root.querySelector(".front-hud")!.textContent!;
    expect(hud).toMatch(/\d+\s*\/\s*\d+/);                 // pool / cap
    const commit = root.querySelector(".front-commit-label")!.textContent!;
    expect(commit).toMatch(/%/);
    expect(commit).toMatch(/\(\d+\)/);                     // absolute troops in brackets
  });

  it("shows conquest progress toward the goal, and the leading rival's progress toward the same goal", () => {
    dispose = mountFrontApp(root, { seed: 11 });
    const text = root.querySelector(".front-hud")!.textContent!;
    // Fresh mount: nobody has gained anything yet, so both segments read "+0/goal" — but they must
    // be present at all, which is the whole point of the finding (no progress was shown before).
    expect(text).toMatch(/정복 [+-]?\d+\/\d+/);
    expect(text).toMatch(/추격 .+ [+-]?\d+\/\d+/);
    expect(text).not.toMatch(/전선/); // no committed fronts yet, so the segment should not appear at all
  });

  it("keeps the pointer cursor available while the game is still live", () => {
    dispose = mountFrontApp(root, { seed: 11 });
    const canvas = root.querySelector("canvas.front-map") as HTMLCanvasElement;
    expect(canvas.style.cursor).not.toBe("default");
  });

  it("right-click on the map always prevents the browser's own context menu, live or not", () => {
    dispose = mountFrontApp(root, { seed: 11 });
    const canvas = root.querySelector("canvas.front-map")!;
    const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 0, clientY: 0 });
    const spy = vi.spyOn(ev, "preventDefault");
    canvas.dispatchEvent(ev);
    expect(spy).toHaveBeenCalled();
  });

  it("moving the slider changes the troops it says it will send", () => {
    dispose = mountFrontApp(root, { seed: 11 });
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

  describe("clickTarget", () => {
    it("returns null for sea", () => {
      const s = initFrontSim(generateWorld({ ...DEFAULT_PARAMS, seed: 11 }).world);
      const player = [...s.owner].find((o) => o >= 0)!;
      const sea = [...Array(s.n).keys()].find((c) => s.owner[c] === SEA)!;
      expect(clickTarget(s, player, sea)).toBeNull();
    });

    it("returns null for the player's own land", () => {
      const s = initFrontSim(generateWorld({ ...DEFAULT_PARAMS, seed: 11 }).world);
      const player = [...s.owner].find((o) => o >= 0)!;
      const mine = [...Array(s.n).keys()].find((c) => s.owner[c] === player)!;
      expect(clickTarget(s, player, mine)).toBeNull();
    });

    it("returns the rival's nation id for the rival's land", () => {
      const s = initFrontSim(generateWorld({ ...DEFAULT_PARAMS, seed: 11 }).world);
      const nations = [...new Set([...s.owner].filter((o) => o >= 0))].sort((a, b) => a - b);
      const player = nations[0], rival = nations[1];
      const theirs = [...Array(s.n).keys()].find((c) => s.owner[c] === rival)!;
      expect(clickTarget(s, player, theirs)).toBe(rival);
    });

    it("returns UNOWNED for unowned land", () => {
      const s = initFrontSim(generateWorld({ ...DEFAULT_PARAMS, seed: 11 }).world);
      const player = [...s.owner].find((o) => o >= 0)!;
      const empty = [...Array(s.n).keys()].find((c) => s.owner[c] === UNOWNED);
      if (empty === undefined) return; // this seed may have no unowned land; nothing to assert
      expect(clickTarget(s, player, empty)).toBe(UNOWNED);
    });

    it("returns null for a cell index out of range", () => {
      const s = initFrontSim(generateWorld({ ...DEFAULT_PARAMS, seed: 11 }).world);
      const player = [...s.owner].find((o) => o >= 0)!;
      expect(clickTarget(s, player, -1)).toBeNull();
      expect(clickTarget(s, player, s.n)).toBeNull();
    });

    // The map must go inert once there is an outcome: a click that still ran startAttack would
    // deduct troops and repaint the HUD for a simulation that will never step again. clickTarget is
    // where both the click and the right-click handlers get this guard, so it is the guard to pin.
    describe("once the game has an outcome", () => {
      it("returns null instead of a target when the player has been defeated, and a click changes nothing", () => {
        const s = initFrontSim(generateWorld({ ...DEFAULT_PARAMS, seed: 11 }).world);
        const nations = [...new Set([...s.owner].filter((o) => o >= 0))].sort((a, b) => a - b);
        const player = nations[0], rival = nations[1];
        // Hand every one of the player's cells to a rival: the only way to reach s.tiles[player] === 0
        // without touching frontSim's internals directly.
        for (let c = 0; c < s.n; c++) if (s.owner[c] === player) setOwner(s, c, rival);
        expect(outcome(s, player)).toEqual({ kind: "defeat" });
        const theirs = [...Array(s.n).keys()].find((c) => s.owner[c] === rival)!;
        const troopsBefore = s.troops[player];
        expect(clickTarget(s, player, theirs)).toBeNull();
        // What the real click handler does with a null target: nothing. Pin that a click landing on
        // a perfectly valid rival cell still leaves the player's pool untouched once defeated.
        expect(s.troops[player]).toBe(troopsBefore);
      });

      it("returns null instead of a target once the player has won, and a click changes nothing", () => {
        const s = initFrontSim(generateWorld({ ...DEFAULT_PARAMS, seed: 11 }).world);
        const nations = [...new Set([...s.owner].filter((o) => o >= 0))].sort((a, b) => a - b);
        const player = nations[0];
        const goal = goalGain(s);
        const grabbable = [...Array(s.n).keys()].filter((c) => s.owner[c] !== SEA && s.owner[c] !== player);
        expect(grabbable.length).toBeGreaterThanOrEqual(goal); // sanity: this seed has enough land to win from
        for (const c of grabbable.slice(0, goal)) setOwner(s, c, player);
        expect(outcome(s, player)).toEqual({ kind: "victory" });
        const stillHostile = [...Array(s.n).keys()].find((c) => s.owner[c] !== SEA && s.owner[c] !== player)!;
        const troopsBefore = s.troops[player];
        expect(clickTarget(s, player, stillHostile)).toBeNull();
        expect(s.troops[player]).toBe(troopsBefore);
      });

      it("returns null instead of a target once outpaced by a rival who reached the goal first", () => {
        const s = initFrontSim(generateWorld({ ...DEFAULT_PARAMS, seed: 11 }).world);
        const nations = [...new Set([...s.owner].filter((o) => o >= 0))].sort((a, b) => a - b);
        const player = nations[0], rival = nations[1];
        const goal = goalGain(s);
        const grabbable = [...Array(s.n).keys()]
          .filter((c) => s.owner[c] !== SEA && s.owner[c] !== player && s.owner[c] !== rival);
        expect(grabbable.length).toBeGreaterThanOrEqual(goal);
        for (const c of grabbable.slice(0, goal)) setOwner(s, c, rival);
        expect(outcome(s, player)).toEqual({ kind: "outpaced", by: rival });
        const theirs = [...Array(s.n).keys()].find((c) => s.owner[c] === rival)!;
        expect(clickTarget(s, player, theirs)).toBeNull();
      });
    });
  });

  describe("playerFronts", () => {
    it("is empty when the player has no live attacks", () => {
      const s = initFrontSim(generateWorld({ ...DEFAULT_PARAMS, seed: 11 }).world);
      const player = [...s.owner].find((o) => o >= 0)!;
      expect(playerFronts(s, player)).toEqual([]);
    });

    it("lists the player's own fronts, not a rival's, with the troops committed", () => {
      const s = initFrontSim(generateWorld({ ...DEFAULT_PARAMS, seed: 11 }).world);
      const nations = [...new Set([...s.owner].filter((o) => o >= 0))].sort((a, b) => a - b);
      const player = nations[0], rival = nations[1];
      expect(startAttack(s, player, rival, 0.3)).toBe(true);
      expect(startAttack(s, rival, player, 0.3)).toBe(true); // a rival's own front — must not leak in
      const fronts = playerFronts(s, player);
      expect(fronts).toHaveLength(1);
      expect(fronts[0].target).toBe(rival);
      expect(fronts[0].pool).toBeGreaterThan(0);
    });
  });

  describe("leadingRival", () => {
    it("returns the rival with the greatest gain, not merely the nearest neighbour", () => {
      const s = initFrontSim(generateWorld({ ...DEFAULT_PARAMS, seed: 11 }).world);
      const nations = [...new Set([...s.owner].filter((o) => o >= 0))].sort((a, b) => a - b);
      if (nations.length < 3) return; // this seed needs at least two rivals; nothing to compare otherwise
      const [player, rivalA, rivalB] = nations;
      const empty = [...Array(s.n).keys()].filter((c) => s.owner[c] === UNOWNED);
      if (empty.length < 4) return; // needs enough unclaimed land to give the two rivals different gains
      setOwner(s, empty[0], rivalA);
      setOwner(s, empty[1], rivalB);
      setOwner(s, empty[2], rivalB);
      setOwner(s, empty[3], rivalB);
      expect(leadingRival(s, player)).toEqual({ nation: rivalB, gained: 3 });
    });

    it("breaks a tie by the lower nation id", () => {
      const s = initFrontSim(generateWorld({ ...DEFAULT_PARAMS, seed: 11 }).world);
      const nations = [...new Set([...s.owner].filter((o) => o >= 0))].sort((a, b) => a - b);
      if (nations.length < 3) return;
      const [player, rivalA] = nations;
      // Nobody has gained anything yet, so every living rival is tied at 0 — the lowest id must win.
      expect(leadingRival(s, player)).toEqual({ nation: rivalA, gained: 0 });
    });

    it("excludes a rival that has been fully conquered", () => {
      const s = initFrontSim(generateWorld({ ...DEFAULT_PARAMS, seed: 11 }).world);
      const nations = [...new Set([...s.owner].filter((o) => o >= 0))].sort((a, b) => a - b);
      if (nations.length < 3) return;
      const [player, rivalA, rivalB] = nations;
      for (let c = 0; c < s.n; c++) if (s.owner[c] === rivalA) setOwner(s, c, player);
      const result = leadingRival(s, player);
      expect(result?.nation).not.toBe(rivalA);
      expect(result?.nation).toBe(rivalB);
    });
  });

  describe("animation loop", () => {
    // jsdom's requestAnimationFrame genuinely fires on a real timer (verified separately), which
    // makes it unsuitable for a deterministic test of the loop's own control flow: we replace it
    // with a spy that hands back the queued callback, so the test drives frames by calling that
    // callback directly instead of waiting on real time. Restored after every test so later tests in
    // this file still get the real (or jsdom's) requestAnimationFrame.
    let liveSpies: { mockRestore: () => void }[] = [];
    afterEach(() => { liveSpies.forEach((sp) => sp.mockRestore()); liveSpies = []; });

    function stubRaf() {
      const queued: FrameRequestCallback[] = [];
      let nextId = 1;
      const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame")
        .mockImplementation((cb) => { queued.push(cb); return nextId++; });
      const cafSpy = vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});
      liveSpies.push(rafSpy, cafSpy);
      return { queued, rafSpy, cafSpy };
    }

    it("clamps a huge elapsed gap instead of catching up thousands of ticks in one frame", () => {
      const { queued } = stubRaf();
      dispose = mountFrontApp(root, { seed: 11 });
      const frame = queued[queued.length - 1];
      // `last` is only established inside `if (last)`, and 0 is falsy — priming with frame(0) would
      // never set it, leaving every later frame() a no-op that skips the tick loop entirely and
      // passes for the wrong reason. A genuine nonzero timestamp is required to prime the loop.
      frame(1000);                 // establishes `last`; no ticks yet, acc starts at 0
      (tick as any).mockClear();
      const gapMs = 10 * 60 * 1000;               // ten minutes, as after a backgrounded tab
      const unclampedTicks = Math.floor(gapMs / (1000 / TICK_HZ));
      frame(1000 + gapMs);
      // Unclamped this gap is thousands of ticks (unclampedTicks); the clamp caps elapsed time to
      // MAX_FRAME_MS before it reaches the accumulator, so only a couple of ticks actually fire.
      // Counting real (unmocked-behaviour) calls to `tick` counts real simulation steps — each call
      // increments the state's own `tick` counter — so this cannot pass just because the loop never ran.
      expect(unclampedTicks).toBeGreaterThan(1000);
      expect((tick as any).mock.calls.length).toBeGreaterThan(0);
      expect((tick as any).mock.calls.length).toBeLessThan(10);
    });

    it("stops the loop so a second mount does not leave the first one running", () => {
      const { queued, cafSpy } = stubRaf();
      const disposeFirst = mountFrontApp(root, { seed: 11 });
      const firstFrame = queued[queued.length - 1];
      const scheduledBeforeStop = queued.length;

      disposeFirst();
      expect(cafSpy).toHaveBeenCalled();

      // A frame already queued before stop() can still fire in a real browser (the cancel and the
      // callback can race); the loop must not act on it or reschedule itself if it does.
      (tick as any).mockClear();
      firstFrame(1000);
      expect((tick as any).mock.calls.length).toBe(0);
      expect(queued.length).toBe(scheduledBeforeStop); // no further frame was scheduled

      dispose = mountFrontApp(root, { seed: 12 }); // the second instance is unaffected
    });
  });
});
